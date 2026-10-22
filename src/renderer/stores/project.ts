import { create } from 'zustand'
import type { FileNode, ProjectInfo } from '@shared/ipc'
import { invokeOrThrow } from '../api'
import { useEditorStore, perTabStates } from './editor'

/**
 * Drop every piece of state that belongs to the previously open project.
 * Without this a tab (e.g. `main.tex`) from project A stayed alive when
 * project B was opened, and auto-open would activate the stale tab/content.
 *
 * Synchronous by design: it must run before the new file tree arrives and
 * triggers auto-open. Compile/index stores reset themselves via project-store
 * subscriptions (see compile.ts / projectIndex.ts).
 */
export function resetProjectSessionState(): void {
  perTabStates.clear()
  useEditorStore.setState({
    tabs: [],
    activePath: null,
    cursorInfo: { line: 1, column: 1 },
    vimMode: null,
    selectionInfo: null,
    diskConflict: null,
    jumpRequest: null,
    citationRequest: null,
    snippetRequest: null,
    spellIgnored: new Set(),
  })
}

interface ProjectStore {
  project: ProjectInfo | null
  fileTree: FileNode | null
  treeError: string | null
  loading: boolean

  openPath: (path: string) => Promise<void>
  refreshTree: () => Promise<void>
  setMainFile: (relPath: string) => Promise<void>
  closeProject: () => Promise<void>
  reloadCurrent: () => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  fileTree: null,
  treeError: null,
  loading: false,

  openPath: async (path) => {
    // Clear the previous project's session and tree so auto-open logic never
    // acts on stale tabs or a stale file list.
    if (get().project?.path !== path) resetProjectSessionState()
    set({ loading: true, treeError: null, fileTree: null })
    try {
      const project = await invokeOrThrow('project:open', { path })
      set({ project, loading: false })
      await get().refreshTree()
    } catch (err) {
      set({ loading: false, treeError: err instanceof Error ? err.message : String(err) })
    }
  },

  refreshTree: async () => {
    if (!get().project) return
    try {
      const tree = await invokeOrThrow('project:listTree', undefined)
      set({ fileTree: tree, treeError: null })
    } catch (err) {
      set({ treeError: err instanceof Error ? err.message : String(err) })
    }
  },

  setMainFile: async (relPath) => {
    const { project } = get()
    if (!project) return
    try {
      const config = await invokeOrThrow('project:setConfig', { patch: { mainFile: relPath } })
      set({ project: { ...project, config } })
    } catch {
      // Toast surface comes with the global error handling later.
    }
  },

  closeProject: async () => {
    try {
      await invokeOrThrow('project:close', undefined)
    } finally {
      set({ project: null, fileTree: null, treeError: null })
      // Drop per-project editor state so the dashboard starts clean (compile
      // and index stores follow the project-path subscription).
      resetProjectSessionState()
    }
  },

  reloadCurrent: async () => {
    const { project } = get()
    if (!project) return
    await get().openPath(project.path)
  },
}))
