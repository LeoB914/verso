import { create } from 'zustand'
import { invokeOrThrow } from '../api'

export interface OpenFile {
  relPath: string
  /** Last-known disk content (baseline for dirty flag). */
  diskContent: string
  /** Current editor text. */
  content: string
  mtime: number
  crlf: boolean
  hadBom: boolean
  dirty: boolean
  /** Read-only tabs (e.g. raw log viewer) cannot be edited or saved. */
  readOnly?: boolean
  /** Preview tabs show an image or PDF instead of text. */
  preview?: 'image' | 'pdf'
}

interface EditorStore {
  tabs: OpenFile[]
  activePath: string | null
  cursorInfo: { line: number; column: number }
  /** Current Vim mode (normal/insert/visual/replace) or null when off. */
  vimMode: string | null
  /** Non-empty editor selection, positioned relative to the editor view. */
  selectionInfo: {
    from: number
    to: number
    text: string
    left: number
    top: number
    bottom: number
  } | null
  /** Bumped when a problem click requests a jump to file+line. */
  jumpRequest: { relPath: string; line: number } | null
  /** Citation insertion requested by the References panel, applied at cursor. */
  citationRequest: { command: string; key: string; id: number } | null
  /** Snippet requested by drag & drop / commands, applied at the cursor. */
  snippetRequest: { text: string; id: number } | null
  spellIgnored: Set<string>
  /** Non-null when an open, dirty file changed on disk. */
  diskConflict: { relPath: string } | null

  openFileByPath: (
    relPath: string,
    opts?: { readOnly?: boolean; preview?: 'image' | 'pdf' }
  ) => Promise<void>
  setActive: (relPath: string) => void
  closeTab: (relPath: string, opts?: { force?: boolean }) => Promise<void>
  closeOtherTabs: (relPath: string) => Promise<void>
  reorderTabs: (from: number, to: number) => void
  updateContent: (relPath: string, content: string) => void
  markDirty: (relPath: string, dirty: boolean) => void
  setCursor: (line: number, column: number) => void
  setVimMode: (mode: string | null) => void
  setSelectionInfo: (info: EditorStore['selectionInfo']) => void
  applyJump: (relPath: string, line: number) => Promise<void>
  clearJump: () => void
  requestCitationInsert: (command: string, key: string) => void
  clearCitationRequest: () => void
  requestSnippet: (text: string) => void
  clearSnippetRequest: () => void
  save: () => Promise<void>
  saveAll: () => Promise<boolean>
  saveTab: (relPath: string) => Promise<void>
  reloadTab: (relPath: string) => Promise<void>
  ignoreWord: (word: string) => void
  dirtyCount: () => number
  setDiskConflict: (relPath: string | null) => void
  /** A file/folder was renamed or moved: re-key its open tabs, keeping edits. */
  renamePath: (oldPath: string, newPath: string) => void
  /** Files/folders were moved to the trash from the app: close their tabs. */
  dropPaths: (paths: string[]) => void
}

/** `relPath` is `base` or lies inside the folder `base`. */
function isAtOrBelow(relPath: string, base: string): boolean {
  return relPath === base || relPath.startsWith(base + '/')
}

/** In-flight file reads, keyed by relPath: concurrent opens must not create duplicate tabs. */
const pendingOpens = new Map<string, Promise<void>>()

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [],
  activePath: null,
  cursorInfo: { line: 1, column: 1 },
  vimMode: null,
  selectionInfo: null,
  jumpRequest: null,
  citationRequest: null,
  snippetRequest: null,
  spellIgnored: new Set(),
  diskConflict: null,

  openFileByPath: async (relPath, opts) => {
    const existing = get().tabs.find((t) => t.relPath === relPath)
    if (existing) {
      set({ activePath: relPath })
      return
    }
    // Auto-open (main.tex), project restore and user clicks can race. Share one
    // read per path and re-check the store after it resolves.
    const inFlight = pendingOpens.get(relPath)
    if (inFlight) {
      await inFlight
      if (get().tabs.some((tab) => tab.relPath === relPath)) set({ activePath: relPath })
      return
    }
    const open = (async () => {
      try {
        const file = await invokeOrThrow('file:read', { relPath })
        set((s) => {
          if (s.tabs.some((tab) => tab.relPath === relPath)) {
            return { activePath: relPath }
          }
          return {
            tabs: [
              ...s.tabs,
              {
                relPath,
                diskContent: file.content,
                content: file.content,
                mtime: file.mtime,
                crlf: file.crlf,
                hadBom: file.hadBom,
                dirty: false,
                readOnly: opts?.readOnly,
                preview: opts?.preview,
              },
            ],
            activePath: relPath,
          }
        })
      } catch (err) {
        console.error('Failed to open file', err)
      }
    })()
    pendingOpens.set(relPath, open)
    try {
      await open
    } finally {
      pendingOpens.delete(relPath)
    }
  },

  setActive: (relPath) => set({ activePath: relPath }),

  closeTab: async (relPath, opts) => {
    const { tabs, activePath } = get()
    const tab = tabs.find((t) => t.relPath === relPath)
    if (!tab) return
    if (tab.dirty && !opts?.force) {
      const ok = await invokeOrThrow('dialog:confirm', {
        title: 'Unsaved changes',
        message: `${relPath} has unsaved changes. Close anyway?`,
        confirmLabel: 'Close without saving',
      })
      if (!ok) return
    }
    const index = tabs.findIndex((t) => t.relPath === relPath)
    const remaining = tabs.filter((t) => t.relPath !== relPath)
    const nextActive =
      activePath === relPath
        ? (remaining[Math.min(index, remaining.length - 1)]?.relPath ?? null)
        : activePath
    set({ tabs: remaining, activePath: nextActive })
    perTabStates.delete(relPath)
  },

  closeOtherTabs: async (relPath) => {
    const { tabs } = get()
    for (const tab of tabs) {
      if (tab.relPath !== relPath) await get().closeTab(tab.relPath)
    }
    set({ activePath: relPath })
  },

  reorderTabs: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs]
      const [moved] = tabs.splice(from, 1)
      tabs.splice(to, 0, moved)
      return { tabs }
    }),

  updateContent: (relPath, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.relPath === relPath ? { ...t, content, dirty: content !== t.diskContent } : t
      ),
    })),

  markDirty: (relPath, dirty) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.relPath === relPath ? { ...t, dirty } : t)) })),

  setCursor: (line, column) => set({ cursorInfo: { line, column } }),
  setVimMode: (vimMode) => set({ vimMode }),
  setSelectionInfo: (selectionInfo) => set({ selectionInfo }),

  applyJump: async (relPath, line) => {
    const current = get().activePath
    if (current !== relPath) {
      await get().openFileByPath(relPath)
    }
    set({ jumpRequest: { relPath, line } })
  },

  clearJump: () => set({ jumpRequest: null }),

  requestCitationInsert: (command, key) => {
    set({ citationRequest: { command, key, id: Date.now() + Math.random() } })
  },

  clearCitationRequest: () => set({ citationRequest: null }),

  requestSnippet: (text) => {
    set({ snippetRequest: { text, id: Date.now() + Math.random() } })
  },

  clearSnippetRequest: () => set({ snippetRequest: null }),

  save: async () => {
    const { activePath } = get()
    if (activePath) await get().saveTab(activePath)
  },

  saveAll: async () => {
    const dirty = get().tabs.filter((tab) => tab.dirty && !tab.readOnly)
    for (const tab of dirty) await get().saveTab(tab.relPath)
    return get().tabs.every((tab) => !tab.dirty || tab.readOnly)
  },

  saveTab: async (relPath) => {
    const tab = get().tabs.find((t) => t.relPath === relPath)
    if (!tab || !tab.dirty || tab.readOnly) return
    // Remember exactly what was sent: text typed during the round-trip must
    // stay dirty.
    const sentContent = tab.content
    try {
      const { mtime } = await invokeOrThrow('file:write', {
        relPath,
        content: sentContent,
        expectedMtime: tab.mtime,
      })
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.relPath === relPath
            ? {
                ...t,
                mtime,
                diskContent: sentContent,
                dirty: t.content !== sentContent,
              }
            : t
        ),
      }))
    } catch (err) {
      void import('./toast').then(({ toast }) =>
        toast('error', err instanceof Error ? err.message : String(err))
      )
    }
  },

  reloadTab: async (relPath) => {
    try {
      const file = await invokeOrThrow('file:read', { relPath })
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.relPath === relPath
            ? {
                ...t,
                diskContent: file.content,
                content: file.content,
                mtime: file.mtime,
                dirty: false,
              }
            : t
        ),
      }))
      perTabStates.delete(relPath)
    } catch {
      // File may have been deleted; keep the tab as-is.
    }
  },

  ignoreWord: (word) =>
    set((s) => {
      const next = new Set(s.spellIgnored)
      next.add(word.toLowerCase())
      return { spellIgnored: next }
    }),

  dirtyCount: () => get().tabs.filter((t) => t.dirty).length,

  setDiskConflict: (relPath) => set({ diskConflict: relPath ? { relPath } : null }),

  renamePath: (oldPath, newPath) => {
    const rekey = (relPath: string): string =>
      isAtOrBelow(relPath, oldPath) ? newPath + relPath.slice(oldPath.length) : relPath
    for (const [relPath, state] of [...perTabStates]) {
      if (!isAtOrBelow(relPath, oldPath)) continue
      perTabStates.delete(relPath)
      perTabStates.set(rekey(relPath), state)
    }
    set((s) => ({
      tabs: s.tabs.map((tab) => ({ ...tab, relPath: rekey(tab.relPath) })),
      activePath: s.activePath === null ? null : rekey(s.activePath),
      diskConflict: s.diskConflict ? { relPath: rekey(s.diskConflict.relPath) } : null,
    }))
  },

  dropPaths: (paths) => {
    const dropped = (relPath: string): boolean => paths.some((base) => isAtOrBelow(relPath, base))
    for (const relPath of [...perTabStates.keys()])
      if (dropped(relPath)) perTabStates.delete(relPath)
    set((s) => {
      const tabs = s.tabs.filter((tab) => !dropped(tab.relPath))
      const activeGone = s.activePath !== null && dropped(s.activePath)
      return {
        tabs,
        activePath: activeGone ? (tabs[0]?.relPath ?? null) : s.activePath,
        diskConflict: s.diskConflict && dropped(s.diskConflict.relPath) ? null : s.diskConflict,
      }
    })
  },
}))

/** Per-tab CodeMirror states (undo history, selection, scroll) — kept outside React. */
export const perTabStates = new Map<string, unknown>()
