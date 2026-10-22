import { Bold, BookOpen, Italic, Link, List, ListOrdered, Sigma } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { getActiveEditorView } from '../editor/CodeMirrorEditor'
import { wrapSelection } from '../editor/latex-editing'
import { useEditorStore } from '../stores/editor'
import { useVisualMode } from '../stores/visualMode'
import { askText } from '../stores/prompt'

/** Floating format toolbar shown on a selection in Visual mode. */
export function SelectionToolbar(): React.JSX.Element | null {
  const selection = useEditorStore((s) => s.selectionInfo)
  const visualEnabled = useVisualMode((s) => s.enabled)
  const activePath = useEditorStore((s) => s.activePath)
  if (!visualEnabled || !selection || !activePath?.toLowerCase().endsWith('.tex')) return null

  const withView = (action: (view: EditorView) => void): void => {
    const view = getActiveEditorView()
    if (!view) return
    action(view)
  }

  const list = (environment: 'itemize' | 'enumerate'): void =>
    withView((view) => {
      const range = view.state.selection.main
      const text = view.state.doc.sliceString(range.from, range.to)
      const lines = text.split('\n').filter((line) => line.trim().length > 0)
      if (lines.length === 0) return
      const body = lines.map((line) => `  \\item ${line.trim()}`).join('\n')
      const insert = `\\begin{${environment}}\n${body}\n\\end{${environment}}`
      view.dispatch({
        changes: { from: range.from, to: range.to, insert },
        selection: { anchor: range.from + insert.length },
      })
      view.focus()
    })

  const link = (): void => {
    void (async () => {
      const url = await askText({
        title: 'Insert link',
        label: 'URL',
        placeholder: 'https://example.org',
        confirmLabel: 'Insert',
      })
      if (!url) return
      withView((view) => {
        const range = view.state.selection.main
        const text = view.state.doc.sliceString(range.from, range.to)
        const insert = `\\href{${url}}{${text}}`
        view.dispatch({
          changes: { from: range.from, to: range.to, insert },
          selection: { anchor: range.from + insert.length },
        })
        view.focus()
      })
    })()
  }

  return (
    <div
      className="absolute z-30 flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 shadow-[var(--shadow-popover)]"
      style={{
        left: Math.max(4, selection.left),
        top: Math.max(4, selection.top - 38),
      }}
      onMouseDown={(event) => event.preventDefault()}
      data-testid="selection-toolbar"
    >
      <ToolButton label="Bold" onClick={() => withView((v) => wrapSelection(v, '\\textbf'))}>
        <Bold size={14} />
      </ToolButton>
      <ToolButton label="Italic" onClick={() => withView((v) => wrapSelection(v, '\\textit'))}>
        <Italic size={14} />
      </ToolButton>
      <ToolButton
        label="Inline math"
        onClick={() =>
          withView((v) => {
            const range = v.state.selection.main
            const text = v.state.doc.sliceString(range.from, range.to)
            v.dispatch({
              changes: { from: range.from, to: range.to, insert: `$${text}$` },
              selection: { anchor: range.from + text.length + 2 },
            })
            v.focus()
          })
        }
      >
        <Sigma size={14} />
      </ToolButton>
      <Separator />
      <ToolButton label="Bulleted list" onClick={() => list('itemize')}>
        <List size={14} />
      </ToolButton>
      <ToolButton label="Numbered list" onClick={() => list('enumerate')}>
        <ListOrdered size={14} />
      </ToolButton>
      <Separator />
      <ToolButton label="Citation" onClick={() => withView((v) => wrapSelection(v, '\\cite'))}>
        <BookOpen size={14} />
      </ToolButton>
      <ToolButton label="Link" onClick={link}>
        <Link size={14} />
      </ToolButton>
    </div>
  )
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Separator(): React.JSX.Element {
  return <span className="mx-0.5 h-3.5 w-px bg-[var(--border-subtle)]" />
}
