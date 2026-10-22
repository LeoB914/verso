import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { CodeMirrorEditor } from '../editor/CodeMirrorEditor'
import { FormatToolbar } from './FormatToolbar'
import { SelectionToolbar } from './SelectionToolbar'
import { figureSnippet } from '../editor/format-actions'
import { useVisualMode } from '../stores/visualMode'
import { useEditorStore } from '../stores/editor'
import { useHistoryStore } from '../stores/history'
import { useProjectStore } from '../stores/project'
import { invokeOrThrow } from '../api'
import { PdfViewer } from '../pdf/PdfViewer'
import { DiffViewer } from './DiffViewer'

/**
 * The center pane: text editor, image/PDF preview tabs, autosave and the
 * "file changed on disk" banner with Keep mine / Load theirs.
 */

interface EditorAreaProps {
  dark: boolean
}

export function EditorArea({ dark }: EditorAreaProps): React.JSX.Element {
  const tabs = useEditorStore((s) => s.tabs)
  const activePath = useEditorStore((s) => s.activePath)
  const activeTab = tabs.find((t) => t.relPath === activePath)
  const visualEnabled = useVisualMode((s) => s.enabled)
  const setVisualEnabled = useVisualMode((s) => s.setEnabled)
  const isTex = activePath?.toLowerCase().endsWith('.tex') ?? false
  const conflict = useEditorStore((s) => s.diskConflict)
  const setDiskConflict = useEditorStore((s) => s.setDiskConflict)
  const project = useProjectStore((s) => s.project)
  const [compareOpen, setCompareOpen] = useState(false)

  const handleDrop = async (event: React.DragEvent): Promise<void> => {
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      /\.(png|jpg|jpeg|gif|eps|pdf|svg)$/i.test(file.name)
    )
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) {
      const absolute = window.openleaf.pathForFile(file)
      if (!absolute) continue
      const result = await invokeOrThrow('files:importDropped', {
        sourcePath: absolute,
        targetDir: 'figures',
      })
      if (!result) continue
      // Insert the figure snippet at the cursor (with tab stops).
      useEditorStore.getState().requestSnippet(figureSnippet(result.relPath))
      void useProjectStore.getState().refreshTree()
    }
  }

  if (!project) return <div className="h-full" />

  if (activeTab?.preview === 'image') {
    return (
      <div className="relative flex h-full items-center justify-center overflow-auto p-4">
        <img
          src={`openleaf://project/${activeTab.relPath.split('/').map(encodeURIComponent).join('/')}`}
          alt={activeTab.relPath}
          className="max-h-full max-w-full"
          style={{
            backgroundImage:
              'linear-gradient(45deg, rgba(128,128,128,0.15) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.15) 75%), linear-gradient(45deg, rgba(128,128,128,0.15) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.15) 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 8px 8px',
          }}
          data-testid="image-preview"
        />
      </div>
    )
  }

  if (activeTab?.preview === 'pdf') {
    return (
      <div className="h-full">
        <PdfViewer
          url={`openleaf://project/${activeTab.relPath.split('/').map(encodeURIComponent).join('/')}`}
          version={0}
          invert={false}
          dark={dark}
        />
      </div>
    )
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void handleDrop(e)}
    >
      {conflict && (
        <div
          className="flex h-9 shrink-0 items-center gap-3 border-b border-[var(--warning)] bg-[var(--warning)]/10 px-3 text-[13px]"
          data-testid="conflict-banner"
        >
          <AlertTriangle size={15} className="text-[var(--warning)]" />
          <span className="flex-1">File changed on disk: {conflict.relPath}</span>
          <button
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 hover:bg-[var(--bg-hover)]"
            onClick={() => void handleConflict(conflict.relPath, 'mine')}
          >
            Keep mine
          </button>
          <button
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 hover:bg-[var(--bg-hover)]"
            onClick={() => setCompareOpen(true)}
            data-testid="compare-external"
          >
            Compare…
          </button>
          <button
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 hover:bg-[var(--bg-hover)]"
            onClick={() => void handleConflict(conflict.relPath, 'theirs')}
          >
            Load theirs
          </button>
        </div>
      )}
      {compareOpen && conflict && activeTab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setCompareOpen(false)}
          data-testid="compare-dialog"
        >
          <div
            className="flex max-h-[80vh] w-[860px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-popover)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">Compare: {conflict.relPath}</h2>
              <div className="flex gap-2">
                <button
                  className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[12px] hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    setCompareOpen(false)
                    void handleConflict(conflict.relPath, 'mine')
                  }}
                >
                  Keep mine
                </button>
                <button
                  className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[12px] hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    setCompareOpen(false)
                    void handleConflict(conflict.relPath, 'theirs')
                  }}
                >
                  Load theirs
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
              <DiffViewer before={activeTab.diskContent} after={activeTab.content} dark={dark} />
            </div>
          </div>
        </div>
      )}
      {isTex && (
        <div className="flex h-9 min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2">
          <FormatToolbar />
          <div className="flex-1" />
          <div className="flex rounded-[var(--radius-md)] bg-[var(--bg-hover)] p-0.5">
            {(['source', 'visual'] as const).map((mode) => (
              <button
                key={mode}
                className={`rounded-[4px] px-2.5 py-0.5 text-[12px] font-medium capitalize ${
                  (mode === 'visual') === visualEnabled
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)]'
                }`}
                onClick={() => setVisualEnabled(mode === 'visual')}
                data-testid={`mode-${mode}`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <CodeMirrorEditor dark={dark} />
        <SelectionToolbar />
      </div>
    </div>
  )

  async function handleConflict(relPath: string, choice: 'mine' | 'theirs'): Promise<void> {
    const editor = useEditorStore.getState()
    const tab = editor.tabs.find((t) => t.relPath === relPath)
    if (!tab) return
    if (choice === 'theirs') {
      // Snapshot the user's version before overwriting it from disk.
      useHistoryStore.getState().snapshotNow('Before external reload', undefined, {
        [relPath]: tab.content,
      })
      await editor.reloadTab(relPath)
    } else {
      // Keep mine: overwrite the disk content with the editor content.
      const { mtime } = await invokeOrThrow('file:write', {
        relPath,
        content: tab.content,
        expectedMtime: null,
      })
      useEditorStore.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.relPath === relPath ? { ...t, mtime, diskContent: t.content, dirty: false } : t
        ),
      }))
    }
    setDiskConflict(null)
  }
}
