import { create } from 'zustand'
import type { SnapshotInfo } from '@shared/ipc'
import { invokeOrThrow } from '../api'

interface HistoryStore {
  open: boolean
  snapshots: SnapshotInfo[]
  selectedId: string | null
  selected2Id: string | null
  selectedFile: string | null
  collapsed: boolean

  setOpen: (open: boolean) => void
  refresh: () => Promise<void>
  select: (id: string, secondId?: string) => void
  selectFile: (relPath: string | null) => void
  setCollapsed: (collapsed: boolean) => void
  snapshotNow: (reason: string, label?: string, overrides?: Record<string, string>) => Promise<void>
  restoreFile: (snapshotId: string, relPath: string) => Promise<void>
  restoreProject: (snapshotId: string) => Promise<void>
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  open: false,
  snapshots: [],
  selectedId: null,
  selected2Id: null,
  selectedFile: null,
  collapsed: false,

  setOpen: (open) => set({ open }),

  refresh: async () => {
    try {
      const snapshots = await invokeOrThrow('history:list', undefined)
      set({ snapshots })
      if (!get().selectedId && snapshots.length > 0) {
        set({ selectedId: snapshots[snapshots.length - 1].id })
      }
    } catch {
      set({ snapshots: [] })
    }
  },

  select: (id, secondId) => set({ selectedId: id, selected2Id: secondId ?? null }),

  selectFile: (relPath) => set({ selectedFile: relPath }),

  setCollapsed: (collapsed) => set({ collapsed }),

  snapshotNow: async (reason, label, overrides) => {
    await invokeOrThrow('history:snapshot', {
      reason,
      ...(label !== undefined ? { label } : {}),
      ...(overrides ? { overrides } : {}),
    })
    await get().refresh()
  },

  restoreFile: async (snapshotId, relPath) => {
    const editor = (await import('./editor')).useEditorStore.getState()
    const tab = editor.tabs.find((t) => t.relPath === relPath)
    // A dirty buffer would be lost silently — ask first, and include its
    // content in the "Before restore" snapshot either way.
    let overrides: Record<string, string> | undefined
    if (tab?.dirty) {
      overrides = { [relPath]: tab.content }
      const confirmed = await invokeOrThrow('dialog:confirm', {
        title: 'Restore file',
        message: `"${relPath}" has unsaved changes. Restore the older version anyway?`,
        confirmLabel: 'Restore',
      })
      if (!confirmed) return
    }
    await invokeOrThrow('history:restoreFile', {
      snapshotId,
      relPath,
      ...(overrides ? { overrides } : {}),
    })
    if (editor.tabs.some((t) => t.relPath === relPath)) {
      await editor.reloadTab(relPath)
    }
    await (await import('./project')).useProjectStore.getState().refreshTree()
    await get().refresh()
  },

  restoreProject: async (snapshotId) => {
    const editor = (await import('./editor')).useEditorStore.getState()
    const dirtyTabs = editor.tabs.filter((tab) => tab.dirty && !tab.readOnly && !tab.preview)
    // Unsaved buffers go into the "Before restore" snapshot so nothing is lost.
    let overrides: Record<string, string> | undefined
    if (dirtyTabs.length > 0) {
      const confirmed = await invokeOrThrow('dialog:confirm', {
        title: 'Restore project',
        message: `${dirtyTabs.length} open file(s) have unsaved changes. They are kept in a "Before restore" version. Restore the older project version anyway?`,
        confirmLabel: 'Restore',
      })
      if (!confirmed) return
      overrides = Object.fromEntries(dirtyTabs.map((tab) => [tab.relPath, tab.content]))
    }
    await invokeOrThrow('history:restoreProject', {
      snapshotId,
      ...(overrides ? { overrides } : {}),
    })
    // Every open tab shows the restored state (dirty ones were confirmed above).
    for (const tab of editor.tabs.filter((t) => !t.preview && !t.readOnly)) {
      await editor.reloadTab(tab.relPath)
    }
    await (await import('./project')).useProjectStore.getState().reloadCurrent()
    await get().refresh()
  },
}))
