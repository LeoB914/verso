import { useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Info,
} from 'lucide-react'
import type { LogLevel, LogEntry } from '@shared/ipc'
import { matchErrorHelp } from '@shared/latex/error-help'
import { useCompileStore } from '../stores/compile'
import { useUiStore } from '../stores/ui'
import { useEditorStore } from '../stores/editor'
import { api } from '../api'
import { strings } from '../strings'

type Tab = 'errors' | 'warnings' | 'info' | 'all'

const LEVEL_ICONS: Record<LogLevel, React.JSX.Element> = {
  error: <AlertCircle size={15} className="shrink-0 text-[var(--danger)]" />,
  warning: <AlertTriangle size={15} className="shrink-0 text-[var(--warning)]" />,
  info: <Info size={15} className="shrink-0 text-[var(--text-tertiary)]" />,
}

/** Extract a TeX Live package name from common "not found" messages. */
function missingPackageFromMessage(message: string): string | null {
  const sty = /File `([^']+)\.sty' not found/.exec(message)
  if (sty) return sty[1]
  const notFound = /LaTeX Error: File `([^']+)' not found/.exec(message)
  if (notFound) {
    const name = notFound[1].replace(/\.(sty|cls|def|ldf)$/, '')
    return name
  }
  const pkg = /Package (\S+) .*not found/.exec(message)
  if (pkg) return pkg[1]
  return null
}

export function ProblemsPanel(): React.JSX.Element {
  const logEntries: LogEntry[] = useCompileStore((s) => s.logEntries)
  const applyJump = useEditorStore((s) => s.applyJump)
  const openFileByPath = useEditorStore((s) => s.openFileByPath)
  const [tab, setTab] = useState<Tab>('all')
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const collapsed = useUiStore((s) => s.problemsCollapsed)
  const setCollapsed = useUiStore((s) => s.setProblemsCollapsed)

  const counts = useMemo(
    () => ({
      error: logEntries.filter((e) => e.level === 'error').length,
      warning: logEntries.filter((e) => e.level === 'warning').length,
      info: logEntries.filter((e) => e.level === 'info').length,
    }),
    [logEntries]
  )

  const filtered = useMemo(() => {
    let list = logEntries
    if (tab !== 'all') {
      const level: LogLevel = tab === 'errors' ? 'error' : tab === 'warnings' ? 'warning' : 'info'
      list = list.filter((e) => e.level === level)
    }
    if (filter) {
      const q = filter.toLowerCase()
      list = list.filter((e) => e.message.toLowerCase().includes(q))
    }
    return list
  }, [logEntries, tab, filter])

  const toggleExpand = (index: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const openRawLog = (): void => {
    void openFileByPath('.openleaf/build/main.log')
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
      data-testid="problems-panel"
    >
      <div className="flex h-7 shrink-0 items-center gap-2 overflow-x-hidden px-2">
        <button
          className="no-drag rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand problems' : 'Collapse problems'}
          aria-expanded={!collapsed}
          data-testid="problems-toggle"
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {(
          [
            ['all', strings.problems(counts.error + counts.warning + counts.info)],
            ['errors', `${strings.levelError} ${counts.error}`],
            ['warnings', `${strings.levelWarning} ${counts.warning}`],
            ['info', `${strings.levelInfo} ${counts.info}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium ${
              tab === id
                ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
            onClick={() => setTab(id)}
            data-testid={`problems-tab-${id}`}
          >
            {label}
          </button>
        ))}
        <input
          className="no-drag h-6 w-40 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2 text-[12px]"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex-1" />
        <button
          className="no-drag whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          onClick={() => void openRawLog()}
          title="Open the raw .log file (read-only)"
        >
          View raw log
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-[13px] text-[var(--text-tertiary)]">{strings.noProblems}</p>
        ) : (
          filtered.map((entry, index) => {
            const help = matchErrorHelp(entry.message)
            const pkg = entry.level === 'error' ? missingPackageFromMessage(entry.message) : null
            const isOpen = expanded.has(index)
            return (
              <div key={index} className="border-b border-[var(--border-subtle)]/50">
                <button
                  className="flex w-full items-start gap-2 px-3 py-1 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    if (entry.file && entry.line) {
                      const rel = entry.file.replace(/^\.\//, '')
                      void applyJump(rel, entry.line)
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    void navigator.clipboard.writeText(entry.message)
                  }}
                >
                  {LEVEL_ICONS[entry.level]}
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        entry.level === 'error'
                          ? 'text-[var(--danger)]'
                          : entry.level === 'warning'
                            ? 'text-[var(--warning)]'
                            : 'text-[var(--text-secondary)]'
                      }
                    >
                      {entry.message}
                    </span>
                    {entry.file && (
                      <span className="ml-2 text-[var(--text-tertiary)]">
                        {entry.file.replace(/^\.\//, '')}
                        {entry.line ? `:${entry.line}` : ''}
                      </span>
                    )}
                  </span>
                  {(help || pkg) && (
                    <span
                      role="button"
                      className="shrink-0 rounded p-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpand(index)
                      }}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="px-9 pb-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                    {help && (
                      <>
                        <p className="font-semibold text-[var(--text-primary)]">{help.title}</p>
                        <p>{help.explanation}</p>
                        <p className="mt-1">
                          <span className="font-semibold">How to fix: </span>
                          {help.fix}
                        </p>
                      </>
                    )}
                    {pkg && (
                      <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-hover)] px-2 py-1">
                        <code className="text-[12px]">tlmgr install {pkg}</code>
                        <button
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-[var(--bg-selected)]"
                          onClick={() => void navigator.clipboard.writeText(`tlmgr install ${pkg}`)}
                        >
                          <Copy size={12} />
                          Copy
                        </button>
                      </div>
                    )}
                    <button
                      className="mt-1 flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                      onClick={() => void navigator.clipboard.writeText(entry.message)}
                    >
                      <Copy size={12} />
                      Copy message
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

void api
