import { create } from 'zustand'
import type { CompileStatus, Compiler, LogEntry, TexEnvironment, TexcountResult } from '@shared/ipc'
import { api, invokeOrThrow } from '../api'
import { clearDiagnostics } from '../editor/diagnostics'
import { useProjectStore } from './project'
import { useEditorStore } from './editor'
import { useUiStore } from './ui'
import { useSettingsStore } from './settings'

interface CompileStore {
  status: CompileStatus
  compiler: Compiler
  logEntries: LogEntry[]
  problemsOpen: boolean
  texEnvironment: TexEnvironment | null
  /** Bumped after a successful compile so the PDF pane reloads. */
  pdfVersion: number
  autoCompile: boolean
  wordcount: TexcountResult | null

  setCompiler: (compiler: Compiler) => Promise<void>
  setAutoCompile: (enabled: boolean) => Promise<void>
  /** Called on every editor change; schedules an auto-compile. */
  notifyUserActivity: () => void
  startCompile: () => Promise<void>
  startFreshCompile: () => Promise<void>
  cancelCompile: () => Promise<void>
  refreshLog: () => Promise<void>
  detectTex: (force?: boolean) => Promise<void>
  toggleProblems: (open?: boolean) => void
  refreshWordcount: () => Promise<void>
}

const IDLE: CompileStatus = { state: 'idle' }

export const useCompileStore = create<CompileStore>((set, get) => ({
  status: IDLE,
  compiler: 'pdflatex',
  logEntries: [],
  problemsOpen: false,
  texEnvironment: null,
  pdfVersion: 0,
  autoCompile: false,
  wordcount: null,

  setCompiler: async (compiler) => {
    set({ compiler })
    if (useProjectStore.getState().project) {
      await invokeOrThrow('project:setConfig', { patch: { compiler } }).catch(() => undefined)
    }
  },

  setAutoCompile: async (enabled) => {
    set({ autoCompile: enabled })
    if (useProjectStore.getState().project) {
      await invokeOrThrow('project:setConfig', { patch: { autoCompile: enabled } }).catch(
        () => undefined
      )
    }
    if (enabled) {
      scheduleAutoCompile(autoCompileDelayMs())
    } else if (autoCompileTimer !== null) {
      clearTimeout(autoCompileTimer)
      autoCompileTimer = null
    }
  },

  notifyUserActivity: () => {
    if (!get().autoCompile) return
    scheduleAutoCompile(autoCompileDelayMs())
  },

  startCompile: async () => {
    if (get().status.state === 'compiling') {
      // Never queue more than one: compile once more after the running one.
      // A manual request must survive even when auto-compile is off.
      pendingManualCompile = true
      return
    }
    // Diagnostics from the previous run are stale.
    clearDiagnostics()
    // Save every dirty file first: an unsaved \input file would otherwise be
    // compiled from its stale disk version.
    await useEditorStore.getState().saveAll()
    if (useProjectStore.getState().project) {
      await invokeOrThrow('compile:start', { compiler: get().compiler })
    }
  },

  startFreshCompile: async () => {
    if (useProjectStore.getState().project) {
      clearDiagnostics()
      await invokeOrThrow('compile:fresh', undefined)
    }
  },

  cancelCompile: async () => {
    await invokeOrThrow('compile:cancel', undefined)
  },

  refreshLog: async () => {
    try {
      const entries = await invokeOrThrow('compile:log', undefined)
      set({ logEntries: entries })
    } catch {
      set({ logEntries: [] })
    }
  },

  detectTex: async (force = false) => {
    if (!force && get().texEnvironment) return
    try {
      const env = await invokeOrThrow('tex:detect', undefined)
      set({ texEnvironment: env })
    } catch {
      set({ texEnvironment: null })
    }
  },

  toggleProblems: (open) => set((state) => ({ problemsOpen: open ?? !state.problemsOpen })),

  refreshWordcount: async () => {
    if (!useProjectStore.getState().project) return
    const result = await api.invoke('wordcount:run', undefined)
    if (result.ok) set({ wordcount: result.data })
  },
}))

// --- Auto-compile scheduler (unit-testable with fake timers) ----------------

let autoCompileTimer: ReturnType<typeof setTimeout> | null = null
let pendingCompileAfterRun = false
/** A manual compile was requested while another one was running. */
let pendingManualCompile = false

/** Configured auto-compile idle delay (clamped to the schema range). */
export function autoCompileDelayMs(): number {
  const value = useSettingsStore.getState().settings?.autoCompileDelayMs ?? 1500
  return Math.min(Math.max(value, 500), 10_000)
}

export function scheduleAutoCompile(delayMs: number): void {
  if (autoCompileTimer !== null) clearTimeout(autoCompileTimer)
  autoCompileTimer = setTimeout(() => {
    autoCompileTimer = null
    const store = useCompileStore.getState()
    if (!store.autoCompile) return
    if (store.status.state === 'compiling') {
      pendingCompileAfterRun = true
      return
    }
    void store.startCompile()
  }, delayMs)
}

/** Reset scheduler timers (used by tests). */
export function resetAutoCompileScheduler(): void {
  if (autoCompileTimer !== null) {
    clearTimeout(autoCompileTimer)
    autoCompileTimer = null
  }
  pendingCompileAfterRun = false
  pendingManualCompile = false
}

export function consumePendingCompileAfterRun(): boolean {
  const pending = pendingCompileAfterRun
  pendingCompileAfterRun = false
  return pending
}

// Drop the previous project's compile/Pdf/word-count state when the project
// changes; otherwise an old PDF or problem list leaks into the new project.
let lastCompileProjectPath = useProjectStore.getState().project?.path ?? null
useProjectStore.subscribe((state) => {
  const path = state.project?.path ?? null
  if (path === lastCompileProjectPath) return
  lastCompileProjectPath = path
  resetAutoCompileScheduler()
  useCompileStore.setState({
    // The toolbar picker and compile requests follow the project's compiler.
    compiler: state.project?.config.compiler ?? 'pdflatex',
    status: IDLE,
    logEntries: [],
    pdfVersion: 0,
    wordcount: null,
    problemsOpen: false,
  })
})

/** Start the compile that was queued behind the run that just finished. */
function runQueuedCompile(): void {
  if (pendingManualCompile) {
    pendingManualCompile = false
    pendingCompileAfterRun = false
    void useCompileStore.getState().startCompile()
  } else if (consumePendingCompileAfterRun()) {
    scheduleAutoCompile(400)
  }
}

/** Wire compile status events → store. Called once per window at app start. */
export function subscribeCompileEvents(): () => void {
  return api.on('compile:status', async (status) => {
    const store = useCompileStore.getState()
    if (status.state === 'success') {
      await store.refreshLog()
      useCompileStore.setState((s) => ({ status, pdfVersion: s.pdfVersion + 1 }))
      runQueuedCompile()
      void store.refreshWordcount()
    } else if (status.state === 'error' || status.state === 'canceled') {
      await store.refreshLog()
      useCompileStore.setState({ status })
      if (status.state === 'error') {
        // Make sure the problems panel is expanded when compilation fails.
        useUiStore.getState().setProblemsCollapsed(false)
      }
      if (status.state === 'canceled') {
        // Cancel means stop: drop anything queued behind the canceled run.
        pendingManualCompile = false
        pendingCompileAfterRun = false
      } else {
        runQueuedCompile()
      }
    } else {
      useCompileStore.setState({ status })
    }
  })
}
