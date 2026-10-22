import { create } from 'zustand'

export type SidebarSegment = 'files' | 'outline' | 'search' | 'git' | 'references' | 'symbols'

interface UiStore {
  sidebarVisible: boolean
  /** Active sidebar section, shared by the rail and the sidebar body. */
  sidebarSegment: SidebarSegment
  pdfVisible: boolean
  sidebarSize: number
  pdfSize: number
  pdfInvert: boolean
  chatVisible: boolean
  tableDialogOpen: boolean
  wordCountOpen: boolean
  paletteOpen: boolean
  paletteMode: 'commands' | 'files' | 'sections' | 'cites'
  /** Problems panel collapsed to just its header bar. */
  problemsCollapsed: boolean
  /** Saved pane state to restore after zen mode. */
  zenSaved: { sidebarVisible: boolean; pdfVisible: boolean } | null
  zenMode: boolean

  toggleSidebar: () => void
  setSidebarSegment: (segment: SidebarSegment) => void
  togglePdf: () => void
  setSidebarSize: (size: number) => void
  setPdfSize: (size: number) => void
  setPdfInvert: (invert: boolean) => void
  setChatVisible: (visible: boolean) => void
  setTableDialogOpen: (open: boolean) => void
  setWordCountOpen: (open: boolean) => void
  openPalette: (mode: 'commands' | 'files' | 'sections' | 'cites') => void
  closePalette: () => void
  setSidebarVisible: (visible: boolean) => void
  setPdfVisible: (visible: boolean) => void
  setProblemsCollapsed: (collapsed: boolean) => void
  setZenMode: (enabled?: boolean) => void
}

export const useUiStore = create<UiStore>((set) => ({
  sidebarVisible: true,
  sidebarSegment: 'files',
  pdfVisible: true,
  sidebarSize: 20,
  pdfSize: 45,
  pdfInvert: false,
  chatVisible: false,
  tableDialogOpen: false,
  wordCountOpen: false,
  paletteOpen: false,
  paletteMode: 'commands',
  problemsCollapsed: true,
  zenSaved: null,
  zenMode: false,

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarSegment: (sidebarSegment) => set({ sidebarSegment }),
  togglePdf: () => set((s) => ({ pdfVisible: !s.pdfVisible })),
  setSidebarSize: (sidebarSize) => set({ sidebarSize }),
  setPdfSize: (pdfSize) => set({ pdfSize }),
  setPdfInvert: (pdfInvert) => set({ pdfInvert }),
  setChatVisible: (chatVisible) => set({ chatVisible }),
  setTableDialogOpen: (tableDialogOpen) => set({ tableDialogOpen }),
  setWordCountOpen: (wordCountOpen) => set({ wordCountOpen }),
  openPalette: (paletteMode) => set({ paletteMode, paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setPdfVisible: (pdfVisible) => set({ pdfVisible }),
  setProblemsCollapsed: (problemsCollapsed) => set({ problemsCollapsed }),

  setZenMode: (enabled) =>
    set((s) => {
      const next = enabled ?? !s.zenMode
      if (next && !s.zenMode) {
        return {
          zenMode: true,
          zenSaved: { sidebarVisible: s.sidebarVisible, pdfVisible: s.pdfVisible },
          sidebarVisible: false,
          pdfVisible: false,
        }
      }
      if (!next && s.zenMode) {
        const saved = s.zenSaved ?? { sidebarVisible: true, pdfVisible: true }
        return { zenMode: false, ...saved, zenSaved: null }
      }
      return s
    }),
}))
