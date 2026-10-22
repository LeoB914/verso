import { useEffect, useMemo, useState } from 'react'
import { Download, History, RotateCcw, X } from 'lucide-react'
import type { SnapshotInfo } from '@shared/ipc'
import { diffStats, formatDiffStats } from '@shared/diff'
import { api, invokeOrThrow } from '../api'
import { getIsDark, subscribeTheme } from '../theme'
import { useHistoryStore } from '../stores/history'
import { DiffViewer } from './DiffViewer'

/**
 * History view: timeline grouped by day (left), diff against the current
 * state or between two snapshots (right).
 */

interface FileChange {
  relPath: string
  before: string | null
  after: string | null
  added: number
  removed: number
}

export function HistoryView(): React.JSX.Element {
  const open = useHistoryStore((s) => s.open)
  const snapshots = useHistoryStore((s) => s.snapshots)
  const selectedId = useHistoryStore((s) => s.selectedId)
  const selected2Id = useHistoryStore((s) => s.selected2Id)
  const selectedFile = useHistoryStore((s) => s.selectedFile)
  const collapsed = useHistoryStore((s) => s.collapsed)
  const setOpen = useHistoryStore((s) => s.setOpen)
  const refresh = useHistoryStore((s) => s.refresh)
  const select = useHistoryStore((s) => s.select)
  const selectFile = useHistoryStore((s) => s.selectFile)
  const restoreFile = useHistoryStore((s) => s.restoreFile)
  const restoreProject = useHistoryStore((s) => s.restoreProject)
  const [dark, setDark] = useState(getIsDark())
  const [fileContents, setFileContents] = useState<
    Record<string, { before: string | null; after: string | null }>
  >({})
  const [changedFiles, setChangedFiles] = useState<FileChange[]>([])
  const [version, setVersion] = useState(0)
  const [imagePreview, setImagePreview] = useState<{
    before: string | null
    after: string | null
  } | null>(null)

  useEffect(() => subscribeTheme(() => setDark(getIsDark())), [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const isImageFile = Boolean(selectedFile && /\.(png|jpe?g|gif|svg|webp)$/i.test(selectedFile))
  const selected = snapshots.find((s) => s.id === selectedId) ?? null
  const selected2 = selected2Id ? (snapshots.find((s) => s.id === selected2Id) ?? null) : null

  useEffect(() => {
    if (!selectedFile || !isImageFile) {
      queueMicrotask(() => setImagePreview(null))
      return
    }
    const currentUrl = `openleaf://project/${selectedFile
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`
    void (async () => {
      const afterResult = selected
        ? await api.invoke('history:imageContent', {
            snapshotId: selected.id,
            relPath: selectedFile,
          })
        : null
      const after = afterResult?.ok ? (afterResult.data?.dataUrl ?? currentUrl) : currentUrl
      const beforeResult = selected2
        ? await api.invoke('history:imageContent', {
            snapshotId: selected2.id,
            relPath: selectedFile,
          })
        : null
      const before = beforeResult?.ok ? (beforeResult.data?.dataUrl ?? currentUrl) : currentUrl
      setImagePreview({ before, after })
    })()
  }, [selectedFile, selected, selected2, isImageFile])

  // Load file contents for the selected snapshot(s) and compute changed files.
  useEffect(() => {
    if (!selected) return
    void (async () => {
      const files = new Set<string>([...Object.keys(selected.files)])
      if (selected2) for (const file of Object.keys(selected2.files)) files.add(file)
      const changes: FileChange[] = []
      const contents: Record<string, { before: string | null; after: string | null }> = {}
      for (const relPath of [...files].sort()) {
        const beforeHash = selected2?.files[relPath] ?? null
        const afterHash = selected.files[relPath] ?? null
        if (beforeHash === afterHash) continue
        const before = beforeHash
          ? await invokeOrThrow('history:fileContent', { snapshotId: selected2!.id, relPath })
          : null
        const after = afterHash
          ? await invokeOrThrow('history:fileContent', { snapshotId: selected.id, relPath })
          : null
        contents[relPath] = { before, after }
        const stats = diffStats(before ?? '', after ?? '')
        changes.push({ relPath, before, after, ...stats })
      }
      setFileContents(contents)
      setChangedFiles(changes)
      setVersion((v) => v + 1)
    })()
  }, [selected, selected2])

  const timeline = useMemo(() => {
    const groups = new Map<string, SnapshotInfo[]>()
    for (const snapshot of [...snapshots].reverse()) {
      const day = new Date(snapshot.timestamp).toLocaleDateString()
      const list = groups.get(day) ?? []
      list.push(snapshot)
      groups.set(day, list)
    }
    return [...groups.entries()]
  }, [snapshots])

  const currentFile = selectedFile && fileContents[selectedFile] ? fileContents[selectedFile] : null

  if (!open) return <div className="hidden" />

  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-[var(--bg-content)]"
      data-testid="history-view"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
        <History size={16} />
        <span className="text-[14px] font-semibold">Version History</span>
        <span className="text-[12px] text-[var(--text-tertiary)]">
          {selected2 ? 'comparing two versions' : 'diff against current state'}
        </span>
        <div className="flex-1" />
        <button
          className="rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => void api.invoke('history:exportZip', { snapshotId: selected!.id })}
          disabled={!selected}
          title="Download this snapshot as ZIP"
          data-testid="history-export-zip"
        >
          <Download size={15} />
        </button>
        <button
          className="rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => void restoreProject(selected!.id)}
          disabled={!selected}
          title="Restore the whole project to this snapshot"
        >
          <RotateCcw size={15} />
        </button>
        <button
          className="rounded p-1 hover:bg-[var(--bg-hover)]"
          onClick={() => setOpen(false)}
          title="Close history"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Timeline */}
        <div
          className="w-64 shrink-0 overflow-auto border-r border-[var(--border-subtle)] p-2"
          data-testid="history-timeline"
        >
          {timeline.map(([day, entries]) => (
            <div key={day} className="mb-2">
              <p className="px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                {day}
              </p>
              {entries.map((snapshot) => (
                <button
                  key={snapshot.id}
                  className={`block w-full rounded-[var(--radius-sm)] px-2 py-1 text-left text-[13px] ${
                    selectedId === snapshot.id
                      ? 'bg-[var(--bg-selected)]'
                      : 'hover:bg-[var(--bg-hover)]'
                  }`}
                  onClick={(event) => {
                    if (event.shiftKey && selectedId) {
                      select(selectedId, snapshot.id)
                    } else {
                      select(snapshot.id)
                    }
                  }}
                >
                  <span className="block truncate font-medium">
                    {snapshot.label ?? snapshot.reason}
                  </span>
                  <span className="block text-[11px] text-[var(--text-tertiary)]">
                    {new Date(snapshot.timestamp).toLocaleTimeString()} ·{' '}
                    {Object.keys(snapshot.files).length} files
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Diff */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="w-56 shrink-0 overflow-auto border-r border-[var(--border-subtle)] p-2">
            {changedFiles.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-[var(--text-tertiary)]">
                No changes in this range.
              </p>
            ) : (
              changedFiles.map((change) => (
                <button
                  key={change.relPath}
                  className={`block w-full rounded-[var(--radius-sm)] px-2 py-1 text-left text-[13px] ${
                    selectedFile === change.relPath
                      ? 'bg-[var(--bg-selected)]'
                      : 'hover:bg-[var(--bg-hover)]'
                  }`}
                  onClick={() => selectFile(change.relPath)}
                >
                  <span className="block truncate">{change.relPath}</span>
                  <span className="block text-[11px]">
                    <span className="text-[var(--success)]">
                      {formatDiffStats({ added: change.added, removed: 0 })}
                    </span>{' '}
                    <span className="text-[var(--danger)]">
                      {formatDiffStats({ added: 0, removed: change.removed })}
                    </span>
                  </span>
                  {selectedFile === change.relPath && (
                    <span
                      className="mt-0.5 block text-[11px] text-[var(--accent)]"
                      role="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (selected) void restoreFile(selected.id, change.relPath)
                      }}
                    >
                      Restore this file
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {imagePreview ? (
              <div className="flex gap-3">
                {(['before', 'after'] as const).map((side) => (
                  <figure key={side} className="flex-1 text-center">
                    <img
                      src={imagePreview[side] ?? ''}
                      alt={side}
                      className="mx-auto max-h-[45vh] max-w-full rounded border border-[var(--border-subtle)] bg-white object-contain"
                    />
                    <figcaption className="mt-1 text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                      {side}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : currentFile ? (
              <DiffViewer
                key={`${selectedFile}-${version}-${selected?.id}-${selected2?.id ?? 'current'}`}
                before={currentFile.before ?? ''}
                after={currentFile.after ?? ''}
                dark={dark}
                collapsed={collapsed}
              />
            ) : (
              <p className="p-4 text-[13px] text-[var(--text-tertiary)]">
                Select a file to see the diff.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

void api
