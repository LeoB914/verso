import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/api', () => ({
  api: { invoke: vi.fn(), on: vi.fn(() => () => undefined) },
  invokeOrThrow: vi.fn(async () => ({})),
}))

import { api, invokeOrThrow } from '../../../src/renderer/api'
import {
  consumePendingCompileAfterRun,
  resetAutoCompileScheduler,
  scheduleAutoCompile,
  subscribeCompileEvents,
  useCompileStore,
} from '../../../src/renderer/stores/compile'
import { useProjectStore } from '../../../src/renderer/stores/project'
import { useEditorStore } from '../../../src/renderer/stores/editor'
import type { CompileStatus } from '../../../src/shared/ipc'

const fakeProject = {
  path: '/tmp/project',
  name: 'project',
  config: {
    mainFile: 'main.tex',
    compiler: 'pdflatex' as const,
    shellEscape: false,
    spellLanguage: 'en' as const,
    autoCompile: true,
    spellEnabled: true,
  },
}

describe('auto-compile scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetAutoCompileScheduler()
    useProjectStore.setState({ project: fakeProject })
    useCompileStore.setState({ autoCompile: true, status: { state: 'idle' } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('triggers a compile after the idle delay', async () => {
    vi.mocked(invokeOrThrow).mockClear()
    scheduleAutoCompile(1500)
    await vi.advanceTimersByTimeAsync(1500)
    expect(invokeOrThrow).toHaveBeenCalledWith('compile:start', { compiler: 'pdflatex' })
  })

  it('debounces rapid activity into one compile', async () => {
    vi.mocked(invokeOrThrow).mockClear()
    scheduleAutoCompile(1500)
    scheduleAutoCompile(1500)
    scheduleAutoCompile(1500)
    await vi.advanceTimersByTimeAsync(1500)
    expect(invokeOrThrow).toHaveBeenCalledTimes(1)
  })

  it('does nothing when auto-compile is off', async () => {
    vi.mocked(invokeOrThrow).mockClear()
    useCompileStore.setState({ autoCompile: false })
    scheduleAutoCompile(1500)
    await vi.advanceTimersByTimeAsync(2000)
    expect(invokeOrThrow).not.toHaveBeenCalled()
  })

  it('defers while a compile is running (pending flag)', async () => {
    useCompileStore.setState({ status: { state: 'compiling' } })
    vi.mocked(invokeOrThrow).mockClear()
    scheduleAutoCompile(1500)
    await vi.advanceTimersByTimeAsync(1500)
    expect(invokeOrThrow).not.toHaveBeenCalled()
    expect(consumePendingCompileAfterRun()).toBe(true)
    expect(consumePendingCompileAfterRun()).toBe(false)
  })
})

describe('manual compile requests', () => {
  beforeEach(() => {
    resetAutoCompileScheduler()
    vi.mocked(api.invoke).mockResolvedValue({ ok: false, error: { code: 'x', message: 'x' } })
    useProjectStore.setState({ project: fakeProject })
    useEditorStore.setState({ tabs: [], activePath: null })
    useCompileStore.setState({ autoCompile: false, status: { state: 'idle' } })
  })

  it('a compile requested during a run starts after it, even with auto-compile off', async () => {
    let listener: ((status: CompileStatus) => Promise<void>) | null = null
    vi.mocked(api.on).mockImplementation(((_channel: string, cb: typeof listener) => {
      listener = cb
      return () => undefined
    }) as never)
    subscribeCompileEvents()
    useCompileStore.setState({ status: { state: 'compiling' } })
    vi.mocked(invokeOrThrow).mockClear()
    await useCompileStore.getState().startCompile()
    expect(invokeOrThrow).not.toHaveBeenCalledWith('compile:start', expect.anything())
    await listener!({ state: 'success', pdfRelPath: 'x.pdf', durationMs: 1 })
    await vi.waitFor(() =>
      expect(invokeOrThrow).toHaveBeenCalledWith('compile:start', { compiler: 'pdflatex' })
    )
  })

  it('saves every dirty tab before compiling, not only the active one', async () => {
    const tab = (relPath: string) => ({
      relPath,
      diskContent: 'old',
      content: 'new',
      mtime: 1,
      crlf: false,
      hadBom: false,
      dirty: true,
    })
    useEditorStore.setState({
      tabs: [tab('main.tex'), tab('chapters/intro.tex')],
      activePath: 'main.tex',
    })
    vi.mocked(invokeOrThrow).mockClear()
    vi.mocked(invokeOrThrow).mockResolvedValue({ mtime: 2 })
    await useCompileStore.getState().startCompile()
    const written = vi
      .mocked(invokeOrThrow)
      .mock.calls.filter(([channel]) => channel === 'file:write')
      .map(([, input]) => (input as { relPath: string }).relPath)
    expect(written).toEqual(['main.tex', 'chapters/intro.tex'])
  })

  it('the compiler follows the opened project', () => {
    useProjectStore.setState({
      project: {
        ...fakeProject,
        path: '/tmp/xe',
        config: { ...fakeProject.config, compiler: 'xelatex' },
      },
    })
    expect(useCompileStore.getState().compiler).toBe('xelatex')
  })
})
