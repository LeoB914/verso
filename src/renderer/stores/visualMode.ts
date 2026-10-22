import { create } from 'zustand'

/** Visual mode toggle, remembered per file. */
interface VisualModeStore {
  enabled: boolean
  /** relPath → enabled (per-file memory). */
  perFile: Record<string, boolean>
  activePath: string | null

  setEnabled: (enabled: boolean) => void
  setActivePath: (relPath: string | null) => void
}

export const useVisualMode = create<VisualModeStore>((set, get) => ({
  enabled: false,
  perFile: {},
  activePath: null,

  setEnabled: (enabled) => {
    const { activePath, perFile } = get()
    const nextPerFile = activePath ? { ...perFile, [activePath]: enabled } : perFile
    set({ enabled, perFile: nextPerFile })
  },

  setActivePath: (relPath) => {
    const perFile = get().perFile
    set({ activePath: relPath, enabled: relPath !== null ? (perFile[relPath] ?? false) : false })
  },
}))
