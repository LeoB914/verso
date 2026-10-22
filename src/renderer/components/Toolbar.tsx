import { useEffect } from 'react'
import { ChevronDown, ExternalLink, History, Home, Loader2, Square, Play, Zap } from 'lucide-react'
import { AppLogo } from './AppLogo'
import { api } from '../api'
import { runCommand } from '../commands'
import type { Compiler } from '@shared/ipc'
import { compilers } from '@shared/ipc'
import { useCompileStore } from '../stores/compile'
import { useProjectStore } from '../stores/project'
import { useEditorStore } from '../stores/editor'
import { useHistoryStore } from '../stores/history'
import { strings } from '../strings'

export function Toolbar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const openFile = useEditorStore((s) => s.tabs.find((t) => t.relPath === s.activePath))
  const status = useCompileStore((s) => s.status)
  const compiler = useCompileStore((s) => s.compiler)
  const setCompiler = useCompileStore((s) => s.setCompiler)
  const setAutoCompile = useCompileStore((s) => s.setAutoCompile)
  const autoCompile = useCompileStore((s) => s.autoCompile)
  const startFreshCompile = useCompileStore((s) => s.startFreshCompile)
  const startCompile = useCompileStore((s) => s.startCompile)
  const cancelCompile = useCompileStore((s) => s.cancelCompile)

  // Sync the toggle when a project opens.
  useEffect(() => {
    setAutoCompile(project?.config.autoCompile ?? false)
  }, [project?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const projectName = project?.name ?? strings.appName
  const compiling = status.state === 'compiling'

  /** Native pop-up menu behind the compile split-button chevron. */
  const showCompileMenu = async (): Promise<void> => {
    const picked = await api.invoke('menu:popup', {
      items: [
        { id: 'compile', label: strings.compileButton },
        { id: 'fresh', label: 'Recompile from scratch (clears the build directory)' },
        { id: 'cancel', label: strings.compileCanceled, enabled: compiling },
      ],
    })
    if (!picked.ok) return
    if (picked.data === 'compile') void startCompile()
    if (picked.data === 'fresh') void startFreshCompile()
    if (picked.data === 'cancel') void cancelCompile()
  }

  return (
    <div className="drag-region flex h-[44px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3">
      <button
        className="no-drag ml-20 flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={() => runCommand('project.home')}
        title="Save all files and return to the project overview"
        data-testid="home-button"
      >
        <Home size={15} />
        Overview
      </button>
      <AppLogo size={20} className="shrink-0" />
      <span
        className="truncate text-[15px] font-semibold text-[var(--text-primary)]"
        data-testid="toolbar-title"
      >
        {projectName}
        {openFile?.dirty ? ` ${strings.unsavedDot}` : ''}
      </span>

      <div className="flex-1" />

      <select
        className="no-drag h-7 appearance-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[13px] text-[var(--text-primary)]"
        value={compiler}
        onChange={(e) => void setCompiler(e.target.value as Compiler)}
        aria-label={strings.compilerLabel}
        data-testid="compiler-select"
      >
        {compilers.map((c) => (
          <option key={c} value={c}>
            {c === 'pdflatex' ? 'pdfLaTeX' : c === 'xelatex' ? 'XeLaTeX' : 'LuaLaTeX'}
          </option>
        ))}
      </select>

      <button
        className={`no-drag flex h-7 items-center gap-1 rounded-[var(--radius-md)] border px-2 text-[13px] ${
          autoCompile
            ? 'border-[var(--accent)] bg-[var(--bg-selected)] text-[var(--accent)]'
            : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
        }`}
        onClick={() => void setAutoCompile(!autoCompile)}
        title="Compile automatically after you stop typing"
        aria-pressed={autoCompile}
        data-testid="auto-compile-toggle"
      >
        <Zap size={13} />
        Auto
      </button>

      <div className="no-drag flex items-center gap-2">
        {compiling ? (
          <>
            <span
              className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)]"
              data-testid="compile-status"
            >
              <Loader2 size={15} className="animate-spin" />
              {strings.compiling}
            </span>
            <button
              className="flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-3 text-[13px] hover:bg-[var(--bg-hover)]"
              onClick={() => void cancelCompile()}
              data-testid="cancel-compile-button"
            >
              <Square size={13} />
            </button>
          </>
        ) : (
          <>
            <span className="text-[13px] text-[var(--text-secondary)]" data-testid="compile-status">
              {statusText(status)}
            </span>
            {/* Accent split button: Compile + a chevron with more actions. */}
            <div className="no-drag flex items-stretch">
              <button
                className="flex h-7 items-center gap-1.5 rounded-l-[var(--radius-md)] bg-[var(--accent)] px-3 text-[13px] font-medium text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
                onClick={() => void startCompile()}
                disabled={!project}
                title="Compile the document (Mod+Enter)"
                data-testid="compile-button"
              >
                <Play size={13} />
                {strings.compileButton}
              </button>
              <button
                className="flex h-7 items-center rounded-r-[var(--radius-md)] border-l border-[var(--accent-contrast)]/20 bg-[var(--accent)] px-1.5 text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
                onClick={() => void showCompileMenu()}
                disabled={!project}
                title="More compile actions"
                data-testid="compile-menu-button"
              >
                <ChevronDown size={13} />
              </button>
            </div>
          </>
        )}
      </div>

      <button
        className="no-drag h-7 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-2 text-[13px] hover:bg-[var(--bg-hover)]"
        onClick={() => void window.openleaf.invoke('pdf:detach', undefined)}
        title="Open PDF in new window"
        data-testid="detach-pdf"
      >
        <ExternalLink size={13} />
      </button>
      <button
        className="no-drag h-7 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-2 text-[13px] hover:bg-[var(--bg-hover)]"
        onClick={() => {
          const history = useHistoryStore.getState()
          history.setOpen(!history.open)
        }}
        title="Version History (Mod+Shift+H)"
        data-testid="history-button"
      >
        <History size={13} />
      </button>
    </div>
  )
}

function statusText(status: { state: string; durationMs?: number; message?: string }): string {
  switch (status.state) {
    case 'idle':
      return ''
    case 'success':
      return strings.compileSuccess(status.durationMs ?? 0)
    case 'error':
      return status.message ?? strings.compileFailed
    case 'canceled':
      return strings.compileCanceled
    default:
      return ''
  }
}
