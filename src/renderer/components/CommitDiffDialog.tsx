import { useEffect, useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { api } from '../api'
import { getIsDark, subscribeTheme } from '../theme'
import { DiffViewer } from './DiffViewer'

export interface CommitDiffTarget {
  commitHash: string
  shortHash: string
  message: string
  path: string
  /** git name-status letter (A/M/D/R…). */
  status: string
}

/**
 * Overlay showing one file of a commit: parent version (left) against the
 * commit's version (right). Added files show an empty left side, deleted
 * files an empty right side.
 */
export function CommitDiffDialog({
  target,
  onClose,
}: {
  target: CommitDiffTarget
  onClose: () => void
}): React.JSX.Element {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => getIsDark(),
    () => false
  )
  const [versions, setVersions] = useState<{ before: string; after: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const read = async (commitHash: string): Promise<string> => {
        const result = await api.invoke('git:fileAtCommit', { commitHash, relPath: target.path })
        return result.ok ? (result.data ?? '') : ''
      }
      const [before, after] = await Promise.all([
        target.status === 'A' ? Promise.resolve('') : read(`${target.commitHash}^`),
        target.status === 'D' ? Promise.resolve('') : read(target.commitHash),
      ])
      if (!cancelled) setVersions({ before, after })
    })()
    return () => {
      cancelled = true
    }
  }, [target])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-content)]"
      data-testid="commit-diff"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 text-[13px]">
        <span className="font-mono text-[12px] text-[var(--text-tertiary)]">
          {target.shortHash}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-mono">{target.path}</span>
          <span className="text-[var(--text-secondary)]"> — {target.message}</span>
        </span>
        <button
          className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close diff"
        >
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {versions ? (
          <DiffViewer before={versions.before} after={versions.after} dark={dark} collapsed />
        ) : (
          <p className="p-3 text-[13px] text-[var(--text-tertiary)]">Loading…</p>
        )}
      </div>
    </div>
  )
}
