import { create } from 'zustand'
import type { AppSettings } from '@shared/ipc'
import { api } from '../api'
import { setAppThemeSetting } from '../theme'

interface SettingsStore {
  settings: AppSettings | null
  open: boolean

  load: () => Promise<void>
  setOpen: (open: boolean) => void
  update: (patch: Partial<AppSettings>) => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  open: false,

  load: async () => {
    try {
      const result = await api.invoke('settings:get', undefined)
      if (result.ok) set({ settings: result.data })
    } catch {
      // Keep defaults.
    }
  },

  setOpen: (open) => set({ open }),

  update: async (patch) => {
    const previous = get().settings
    if (previous) set({ settings: { ...previous, ...patch } })
    const result = await api.invoke('settings:set', { patch: patch as never })
    if (result.ok) set({ settings: result.data })
    // Apply theme-affecting settings immediately.
    const current = get().settings
    if (current) setAppThemeSetting(current.appTheme)
  },
}))
