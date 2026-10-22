import { useState, useSyncExternalStore } from 'react'
import type { RecoveryInfo } from '@shared/ipc'
import { AlertTriangle, X } from 'lucide-react'
import { useEditorStore } from '../stores/editor'
import { api } from '../api'
import { strings } from '../strings'
import { DiffViewer } from './DiffViewer'
import { getIsDark, subscribeTheme } from '../theme'

/**
 * Non-blocking sheet offering crash-recovery buffers (written by the renderer
 * every few seconds). Restore loads the content into a dirty tab; the user
 * still decides when to save it.
 */
export function RecoverySheet({
  info,
  onDone,
}: {
  info: RecoveryInfo
  onDone: () => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<{
    relPath: string
    before: string
    after: string
  } | null>(null)
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => getIsDark(),
    () => false
  )

  const showDiff = async (relPath: string, content: string): Promise<void> => {
    const result = await api.invoke('file:read', { relPath })
    setPreview({
      relPath,
      before: result.ok ? result.data.content : '',
      after: content,
    })
  }

  // Files already restored or discarded; the sheet (and the recovery file)
  // only go away once every buffer has been decided.
  const [handled, setHandled] = useState<ReadonlySet<string>>(() => new Set())
  const open = info.buffers.filter((buffer) => !handled.has(buffer.relPath))

  const markHandled = async (relPath: string): Promise<void> => {
    const next = new Set(handled).add(relPath)
    setHandled(next)
    if (preview?.relPath === relPath) setPreview(null)
    if (info.buffers.every((buffer) => next.has(buffer.relPath))) {
      await api.invoke('recovery:clear', undefined)
      onDone()
    }
  }

  const restore = async (relPath: string, content: string): Promise<void> => {
    const editor = useEditorStore.getState()
    await editor.openFileByPath(relPath)
    editor.updateContent(relPath, content)
    editor.markDirty(relPath, true)
    await markHandled(relPath)
  }

  /** Drop one recovered buffer; the others stay available. */
  const discardOne = (relPath: string): Promise<void> => markHandled(relPath)

  const discardAll = async (): Promise<void> => {
    await api.invoke('recovery:clear', undefined)
    onDone()
  }

  return (
    <div
      className="fixed right-3 bottom-10 z-50 w-[360px] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-popover)]"
      data-testid="recovery-sheet"
    >
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle size={15} className="text-[var(--warning)]" />
        <span className="flex-1 text-[13px] font-semibold">{strings.recoveryTitle}</span>
        <button
          className="rounded p-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
          onClick={() => void discardAll()}
          title={strings.recoveryDiscardAll}
          aria-label={strings.recoveryDiscardAll}
        >
          <X size={14} />
        </button>
      </div>
      <p className="mb-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        {strings.recoveryHint}
      </p>
      <div className="flex flex-col gap-1">
        {open.map((buffer) => (
          <div key={buffer.relPath} className="flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate font-mono">{buffer.relPath}</span>
            <button
              className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)]"
              onClick={() => void showDiff(buffer.relPath, buffer.content)}
              data-testid={`recovery-diff-${buffer.relPath}`}
            >
              Diff
            </button>
            <button
              className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-contrast)] hover:opacity-90"
              onClick={() => void restore(buffer.relPath, buffer.content)}
              data-testid={`recovery-restore-${buffer.relPath}`}
            >
              {strings.recoveryRestore}
            </button>
            <button
              className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)]"
              onClick={() => void discardOne(buffer.relPath)}
              data-testid="recovery-discard"
            >
              {strings.recoveryDiscard}
            </button>
          </div>
        ))}
      </div>
      {preview && (
        <div className="mt-2 h-56 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
          <div className="flex items-center justify-between bg-[var(--bg-hover)] px-2 py-0.5 text-[11px]">
            <span className="truncate font-mono">{preview.relPath}</span>
            <button className="text-[var(--text-tertiary)]" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
          <div className="h-[calc(100%-20px)]">
            <DiffViewer before={preview.before} after={preview.after} dark={dark} />
          </div>
        </div>
      )}
    </div>
  )
}
