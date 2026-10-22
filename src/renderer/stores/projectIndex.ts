import { create } from 'zustand'
import type { FileNode, ProjectInfo } from '@shared/ipc'
import { parseStructure, type DocumentStructure, type SectionNode } from '@shared/latex/structure'
import { parseBibFile, type BibEntry } from '@shared/latex/bib-parser'
import { invokeOrThrow } from '../api'
import { useEditorStore } from './editor'
import { useProjectStore } from './project'

export interface LabelInfo {
  key: string
  relPath: string
  line: number
  /** Section title the label sits in, when determinable. */
  section: string | null
}

interface ProjectIndexStore {
  structures: Map<string, DocumentStructure>
  bibEntries: Map<string, BibEntry>
  labels: LabelInfo[]
  definitions: Array<{ name: string; kind: string; argCount: number; relPath: string }>
  /** All section headings across the project (main file first, \input order). */
  outline: Array<SectionNode & { relPath: string }>
  version: number
  /** Project whose files the index currently describes. */
  indexedProjectPath: string | null

  reindex: () => Promise<void>
  reindexFile: (relPath: string) => void
  scheduleFileReindex: (relPath: string) => void
}

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useProjectIndex = create<ProjectIndexStore>((set, get) => ({
  structures: new Map(),
  bibEntries: new Map(),
  labels: [],
  definitions: [],
  outline: [],
  version: 0,
  indexedProjectPath: null,

  reindex: async () => {
    const project = useProjectStore.getState().project
    if (!project) {
      set({
        structures: new Map(),
        bibEntries: new Map(),
        labels: [],
        definitions: [],
        outline: [],
        indexedProjectPath: null,
      })
      return
    }
    // Clear project A's index before indexing project B.
    if (get().indexedProjectPath !== project.path) {
      set({
        structures: new Map(),
        bibEntries: new Map(),
        labels: [],
        definitions: [],
        outline: [],
        version: 0,
        indexedProjectPath: project.path,
      })
    }
    const texFiles = collectTexFiles(useProjectStore.getState().fileTree)
    for (const relPath of texFiles) {
      get().reindexFile(relPath)
    }
    // Also index .bib files.
    const bibFiles = collectBibFiles(useProjectStore.getState().fileTree)
    for (const relPath of bibFiles) {
      try {
        const file = await invokeOrThrow('file:read', { relPath })
        const entries = parseBibFile(file.content)
        set((s) => {
          const bibEntries = new Map(s.bibEntries)
          for (const entry of entries) bibEntries.set(entry.key, entry)
          return { bibEntries }
        })
      } catch {
        // Skip unreadable bib files.
      }
    }
  },

  reindexFile: async (relPath) => {
    const tab = useEditorStore.getState().tabs.find((t) => t.relPath === relPath)
    let text: string | null = tab?.content ?? null
    if (text === null) {
      // Not open: read from disk.
      try {
        const file = await invokeOrThrow('file:read', { relPath })
        text = file.content
      } catch {
        return
      }
    }
    const structure = parseStructure(text)
    set((s) => {
      const structures = new Map(s.structures)
      structures.set(relPath, structure)
      const { labels, definitions, outline } = computeDerived(structures)
      return { structures, labels, definitions, outline, version: s.version + 1 }
    })
  },

  scheduleFileReindex: (relPath) => {
    const existing = debounceTimers.get(relPath)
    if (existing) clearTimeout(existing)
    debounceTimers.set(
      relPath,
      setTimeout(() => {
        debounceTimers.delete(relPath)
        get().reindexFile(relPath)
      }, 400)
    )
  },
}))

function computeDerived(
  structures: Map<string, DocumentStructure>
): Pick<ProjectIndexStore, 'labels' | 'definitions' | 'outline'> {
  const labels: LabelInfo[] = []
  const definitions: ProjectIndexStore['definitions'] = []
  const outline: ProjectIndexStore['outline'] = []

  for (const [relPath, structure] of structures) {
    // Labels with their enclosing section.
    const sortedSections = [...structure.sections].sort((a, b) => a.position - b.position)
    for (const ref of structure.references) {
      if (ref.kind === 'label') {
        let section: string | null = null
        for (const s of sortedSections) {
          if (s.position < ref.position) section = s.title
          else break
        }
        labels.push({ key: ref.key, relPath, line: ref.line, section })
      }
    }
    for (const def of structure.definitions) {
      definitions.push({ name: def.name, kind: def.kind, argCount: def.argCount, relPath })
    }
    for (const section of structure.sections) {
      outline.push({ ...section, relPath })
    }
  }

  // Sort outline: main file first, then others alphabetically; within file by position.
  const mainFile = useProjectStore.getState().project?.config.mainFile
  outline.sort((a, b) => {
    const aMain = a.relPath === mainFile ? 0 : 1
    const bMain = b.relPath === mainFile ? 0 : 1
    if (aMain !== bMain) return aMain - bMain
    if (a.relPath !== b.relPath) return a.relPath.localeCompare(b.relPath)
    return a.position - b.position
  })
  labels.sort((a, b) => a.key.localeCompare(b.key))
  return { labels, definitions, outline }
}

function collectTexFiles(node: FileNode | null): string[] {
  if (!node) return []
  const files: string[] = []
  function walk(n: FileNode): void {
    if (n.type === 'file' && n.relPath.toLowerCase().endsWith('.tex')) {
      // Index only .tex files; .openleaf is already filtered server-side.
      files.push(n.relPath)
    }
    for (const child of n.children ?? []) walk(child)
  }
  walk(node)
  return files
}

function collectBibFiles(node: FileNode | null): string[] {
  if (!node) return []
  const files: string[] = []
  function walk(n: FileNode): void {
    if (n.type === 'file' && n.relPath.toLowerCase().endsWith('.bib')) files.push(n.relPath)
    for (const child of n.children ?? []) walk(child)
  }
  walk(node)
  return files
}

/** Wire the index to editor changes (debounced) and project opens. */
export function subscribeProjectIndex(): () => void {
  const unsubEditor = useEditorStore.subscribe((state, prev) => {
    for (const tab of state.tabs) {
      const before = prev.tabs.find((t) => t.relPath === tab.relPath)
      if (before && before.content !== tab.content) {
        useProjectIndex.getState().scheduleFileReindex(tab.relPath)
      }
    }
  })
  const unsubProject = useProjectStore.subscribe((state, prev) => {
    const project: ProjectInfo | null = state.project
    if (project?.path !== prev.project?.path) {
      void useProjectIndex.getState().reindex()
    }
    // The file tree may arrive after the project — reindex once it does.
    if (state.fileTree && state.fileTree !== prev.fileTree) {
      void useProjectIndex.getState().reindex()
    }
  })
  return () => {
    unsubEditor()
    unsubProject()
  }
}
