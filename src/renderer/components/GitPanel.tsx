import { useCallback, useEffect, useState } from 'react'
import { Circle, Download, GitBranch, GitCommitHorizontal, Upload, X } from 'lucide-react'
import type { GitCommitFile, GitCommitInfo, GitStatusInfo } from '@shared/ipc'
import { api, invokeOrThrow } from '../api'
import { createGitBranch, GIT_CHANGED_EVENT } from '../project-actions'
import { CommitDiffDialog, type CommitDiffTarget } from './CommitDiffDialog'
import { useEditorStore } from '../stores/editor'
import { useProjectStore } from '../stores/project'

/**
 * Source Control sidebar panel: status, staging, commit, pull/push/fetch,
 * branch switcher, simple log.
 */

export function GitPanel(): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [status, setStatus] = useState<GitStatusInfo | null>(null)
  const [isRepo, setIsRepo] = useState(false)
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [log, setLog] = useState<GitCommitInfo[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([])
  const [diffTarget, setDiffTarget] = useState<CommitDiffTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const openFileByPath = useEditorStore((s) => s.openFileByPath)
  const projectPath = useProjectStore((s) => s.project?.path)

  const refresh = useCallback(async (): Promise<void> => {
    const avail = await api.invoke('git:available', undefined)
    setAvailable(avail.ok ? avail.data.available : false)
    if (!projectPath) return
    const st = await api.invoke('git:status', undefined)
    if (st.ok) {
      setStatus(st.data)
      setIsRepo(st.data !== null)
    }
    if (st.ok && st.data !== null) {
      const logResult = await api.invoke('git:log', undefined)
      if (logResult.ok) setLog(logResult.data)
      const branchResult = await api.invoke('git:branches', undefined)
      if (branchResult.ok) setBranches(branchResult.data)
    }
  }, [projectPath])

  useEffect(() => {
    void (async () => {
      await refresh()
    })()
  }, [refresh])

  // Branches created from the command palette / menu.
  useEffect(() => {
    const onChanged = (): void => void refresh()
    window.addEventListener(GIT_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(GIT_CHANGED_EVENT, onChanged)
  }, [refresh])

  const toggleCommit = async (hash: string): Promise<void> => {
    if (expandedCommit === hash) {
      setExpandedCommit(null)
      return
    }
    setExpandedCommit(hash)
    setCommitFiles([])
    const result = await api.invoke('git:commitFiles', { commitHash: hash })
    if (result.ok) setCommitFiles(result.data)
  }

  const run = async (action: () => Promise<string | null | void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const err = await action()
      if (typeof err === 'string' && err) setError(err)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  if (available === false) {
    return (
      <div className="p-3 text-[13px] text-[var(--text-tertiary)]" data-testid="git-unavailable">
        Git is not installed. Install Git to use source control from Verso.
      </div>
    )
  }
  if (available === null)
    return <div className="p-3 text-[13px] text-[var(--text-tertiary)]">Loading…</div>

  if (!isRepo) {
    return (
      <div className="p-3 text-[13px] text-[var(--text-secondary)]" data-testid="git-init">
        <p className="mb-2">This project is not a Git repository yet.</p>
        <button
          className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-3 py-1 hover:bg-[var(--bg-hover)]"
          onClick={() =>
            void run(async () => {
              await invokeOrThrow('git:init', undefined)
              return null
            })
          }
        >
          Initialize Git repository
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-2 text-[13px]" data-testid="git-panel">
      {/* Branch + sync */}
      <div className="mb-2 flex items-center gap-2">
        <GitBranch size={15} className="text-[var(--accent)]" />
        <select
          className="h-6 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-1"
          value={status?.branch ?? ''}
          onChange={(e) => {
            const name = e.target.value
            if (name === NEW_BRANCH_OPTION) {
              void run(async () => {
                await createGitBranch()
                return null
              })
              return
            }
            if (name && name !== status?.branch) {
              void run(async () => {
                const ok = await invokeOrThrow('dialog:confirm', {
                  title: 'Switch branch',
                  message: `Checkout "${name}"? Uncommitted changes may conflict.`,
                  confirmLabel: 'Checkout',
                })
                if (!ok) return null
                await invokeOrThrow('git:checkout', { name, force: false })
                return null
              })
            }
          }}
          aria-label="Branch"
          data-testid="git-branch-select"
        >
          {branchOptions(branches, status?.branch ?? null).map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
          <option value={NEW_BRANCH_OPTION}>New branch…</option>
        </select>
        {status && (status.ahead > 0 || status.behind > 0) && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            ↑{status.ahead} ↓{status.behind}
          </span>
        )}
      </div>
      <div className="mb-2 flex gap-1">
        <button
          className="flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] py-1 hover:bg-[var(--bg-hover)]"
          onClick={() =>
            void run(() => api.invoke('git:pull', undefined).then((r) => (r.ok ? r.data : null)))
          }
        >
          <Download size={13} />
          Pull
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] py-1 hover:bg-[var(--bg-hover)]"
          onClick={() =>
            void run(() => api.invoke('git:fetch', undefined).then((r) => (r.ok ? null : null)))
          }
        >
          Fetch
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] py-1 hover:bg-[var(--bg-hover)]"
          onClick={() =>
            void run(() =>
              api.invoke('git:push', { setUpstream: true }).then((r) => (r.ok ? r.data : null))
            )
          }
        >
          <Upload size={13} />
          Push
        </button>
        {busy && (
          <button
            className="flex items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[var(--danger)] px-2 py-1 text-[var(--danger)] hover:bg-[var(--bg-hover)]"
            onClick={() => void api.invoke('git:cancel', undefined)}
            title="Cancel the running git operation"
            data-testid="git-cancel"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {error && (
        <p className="mb-2 rounded-[var(--radius-sm)] bg-[var(--danger)]/10 px-2 py-1 text-[12px] text-[var(--danger)]">
          {error}
        </p>
      )}

      {/* Changed files */}
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Changes
        </span>
        <button
          className="text-[11px] text-[var(--accent)] hover:underline"
          onClick={() =>
            void run(async () => {
              if (!status) return null
              await invokeOrThrow('git:stage', { paths: status.files.map((f) => f.path) })
              return null
            })
          }
        >
          Stage all
        </button>
      </div>
      <div className="mb-2 max-h-44 overflow-auto">
        {(status?.files ?? []).map((file) => (
          <div
            key={file.path}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1 py-0.5 hover:bg-[var(--bg-hover)]"
          >
            <button
              className="min-w-0 flex-1 truncate text-left"
              title={`Open diff for ${file.path}`}
              onClick={() => void openFileByPath(file.path)}
            >
              <span
                className={`mr-1 font-mono text-[11px] ${file.status === '?' ? 'text-[var(--text-tertiary)]' : 'text-[var(--warning)]'}`}
              >
                {file.status}
              </span>
              <span className="text-[12px]">{file.path.split('/').pop()}</span>
              <span className="ml-1 text-[10px] text-[var(--text-tertiary)]">{file.path}</span>
            </button>
            <button
              className="rounded px-1 text-[11px] text-[var(--accent)] hover:bg-[var(--bg-hover)]"
              onClick={() =>
                void run(async () => {
                  if (file.staged) await invokeOrThrow('git:unstage', { paths: [file.path] })
                  else await invokeOrThrow('git:stage', { paths: [file.path] })
                  return null
                })
              }
            >
              {file.staged ? 'Unstage' : 'Stage'}
            </button>
          </div>
        ))}
        {status?.files.length === 0 && (
          <p className="px-1 py-1 text-[12px] text-[var(--text-tertiary)]">Working tree clean</p>
        )}
        {status && status.conflicted.length > 0 && (
          <div className="mt-1 rounded-[var(--radius-sm)] bg-[var(--warning)]/10 px-2 py-1 text-[12px] text-[var(--warning)]">
            Conflicted: {status.conflicted.join(', ')} — open and resolve the conflict markers.
          </div>
        )}
      </div>

      {/* Commit box */}
      <textarea
        className="mb-1 h-14 resize-none rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2 py-1 text-[12px]"
        placeholder="Commit message… (Mod+Enter to commit)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && message.trim()) {
            void run(async () => {
              await invokeOrThrow('git:commit', { message: message.trim(), amend })
              setMessage('')
              return null
            })
          }
        }}
        data-testid="commit-message"
      />
      <label className="mb-2 flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
        <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
        Amend last commit
      </label>
      <button
        className="mb-2 flex items-center justify-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent)] py-1 text-[12px] font-medium text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
        disabled={!message.trim() || busy}
        onClick={() =>
          void run(async () => {
            await invokeOrThrow('git:commit', { message: message.trim(), amend })
            setMessage('')
            return null
          })
        }
      >
        <GitCommitHorizontal size={13} />
        Commit
      </button>

      {/* Log */}
      <div className="min-h-0 flex-1 overflow-auto border-t border-[var(--border-subtle)] pt-1">
        {log.map((entry) => (
          <div key={entry.hash} className="text-[12px]">
            <button
              className="block w-full rounded-[var(--radius-sm)] px-1 py-0.5 text-left hover:bg-[var(--bg-hover)]"
              onClick={() => void toggleCommit(entry.hash)}
              aria-expanded={expandedCommit === entry.hash}
              data-testid={`git-commit-${entry.shortHash}`}
            >
              <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                {entry.shortHash}
              </span>{' '}
              <span className="truncate">{entry.message}</span>
              <span className="block text-[10px] text-[var(--text-tertiary)]">
                {entry.author} · {new Date(entry.date).toLocaleDateString()}
              </span>
            </button>
            {expandedCommit === entry.hash && (
              <div className="mb-1 ml-3 border-l border-[var(--border-subtle)] pl-2">
                {commitFiles.length === 0 && (
                  <p className="text-[11px] text-[var(--text-tertiary)]">No file changes</p>
                )}
                {commitFiles.map((file) => (
                  <button
                    key={file.path}
                    className="flex w-full items-center gap-1 rounded-[var(--radius-sm)] px-1 text-left text-[11px] hover:bg-[var(--bg-hover)]"
                    onClick={() =>
                      setDiffTarget({
                        commitHash: entry.hash,
                        shortHash: entry.shortHash,
                        message: entry.message,
                        path: file.path,
                        status: file.status,
                      })
                    }
                    title="Show the changes of this file"
                    data-testid={`git-commit-file-${file.path}`}
                  >
                    <span className="w-3 shrink-0 font-mono text-[var(--text-tertiary)]">
                      {file.status}
                    </span>
                    <span className="truncate font-mono">{file.path}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {diffTarget && <CommitDiffDialog target={diffTarget} onClose={() => setDiffTarget(null)} />}
      {log.length === 0 && (
        <p className="px-1 text-[12px] text-[var(--text-tertiary)]">
          <Circle size={11} className="inline" /> No commits yet
        </p>
      )}
    </div>
  )
}

// A leading space can never be part of a git branch name.
const NEW_BRANCH_OPTION = ' new-branch'

/** Local branches for the switcher; the current branch is always present. */
function branchOptions(branches: string[], current: string | null): string[] {
  if (!current || branches.includes(current)) return branches
  return [current, ...branches]
}
