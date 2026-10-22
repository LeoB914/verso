import { Bold, Heading, Image, Italic, Redo2, Sigma, Table, Type, Undo2 } from 'lucide-react'
import { redo, undo } from '@codemirror/commands'
import { getActiveEditorView } from '../editor/CodeMirrorEditor'
import { wrapSelection } from '../editor/latex-editing'
import {
  applyFontSize,
  figureSnippet,
  insertMathBlock,
  insertSection,
} from '../editor/format-actions'
import { useEditorStore } from '../stores/editor'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { api } from '../api'
import { toast } from '../stores/toast'

const FONT_SIZES: Array<[value: string, label: string]> = [
  ['\\tiny', 'Tiny'],
  ['\\scriptsize', 'Script'],
  ['\\footnotesize', 'Footnote'],
  ['\\small', 'Small'],
  ['\\normalsize', 'Normal'],
  ['\\large', 'Large'],
  ['\\Large', 'Larger'],
  ['\\LARGE', 'Largest'],
  ['\\huge', 'Huge'],
  ['\\Huge', 'Hugest'],
]

const SECTIONS: Array<[value: string, label: string]> = [
  ['\\section', 'Section'],
  ['\\subsection', 'Subsection'],
  ['\\subsubsection', 'Subsubsection'],
  ['\\paragraph', 'Paragraph'],
]

/**
 * Compact formatting bar above the editor. Every action runs against the
 * mounted CodeMirror view; nothing is applied to a file that is not open.
 */
export function FormatToolbar(): React.JSX.Element {
  const activePath = useEditorStore((s) => s.activePath)
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.relPath === s.activePath))
  const readOnly = activeTab?.readOnly ?? !activePath

  const withView = (
    action: (view: NonNullable<ReturnType<typeof getActiveEditorView>>) => void
  ) => {
    const view = getActiveEditorView()
    if (!view || readOnly) return
    action(view)
  }

  const pickImage = async (): Promise<void> => {
    const view = getActiveEditorView()
    if (!view || readOnly) return
    const result = await api.invoke('files:pickImage', undefined)
    if (!result.ok) {
      toast('error', result.error.message)
      return
    }
    if (!result.data) return
    useEditorStore.getState().requestSnippet(figureSnippet(result.data.relPath))
    void useProjectStore.getState().refreshTree()
  }

  return (
    <div
      className="no-scrollbar flex min-w-0 shrink-0 items-center gap-0.5"
      data-testid="format-toolbar"
    >
      <label
        className="flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        title="Font size"
      >
        <Type size={15} />
        <select
          className="h-6 max-w-[92px] cursor-pointer appearance-none bg-transparent text-[12px] outline-none"
          value=""
          disabled={readOnly}
          onChange={(event) => {
            const command = event.target.value
            event.target.value = ''
            if (command) withView((view) => applyFontSize(view, command))
          }}
          data-testid="format-font-size"
        >
          <option value="">Size</option>
          {FONT_SIZES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label
        className="flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        title="Insert section heading"
      >
        <Heading size={15} />
        <select
          className="h-6 w-[76px] cursor-pointer appearance-none bg-transparent text-[12px] outline-none"
          value=""
          disabled={readOnly}
          onChange={(event) => {
            const command = event.target.value
            event.target.value = ''
            if (command) withView((view) => insertSection(view, command))
          }}
          data-testid="format-section"
        >
          <option value="">Section</option>
          {SECTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <Divider />

      <ToolbarButton
        label="Bold (Mod+B)"
        disabled={readOnly}
        onClick={() => withView((view) => wrapSelection(view, '\\textbf'))}
        testId="format-bold"
      >
        <Bold size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Italic (Mod+I)"
        disabled={readOnly}
        onClick={() => withView((view) => wrapSelection(view, '\\textit'))}
        testId="format-italic"
      >
        <Italic size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Display math block"
        disabled={readOnly}
        onClick={() => withView((view) => insertMathBlock(view))}
        testId="format-math"
      >
        <Sigma size={16} />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        label="Insert image"
        disabled={readOnly}
        onClick={() => void pickImage()}
        testId="format-image"
      >
        <Image size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Insert table"
        disabled={readOnly}
        onClick={() => useUiStore.getState().setTableDialogOpen(true)}
        testId="format-table"
      >
        <Table size={16} />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        label="Undo (Mod+Z)"
        disabled={readOnly}
        onClick={() => withView((view) => void undo(view))}
        testId="format-undo"
      >
        <Undo2 size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="Redo (Mod+Shift+Z)"
        disabled={readOnly}
        onClick={() => withView((view) => void redo(view))}
        testId="format-redo"
      >
        <Redo2 size={16} />
      </ToolbarButton>
    </div>
  )
}

function Divider(): React.JSX.Element {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--border-subtle)]" />
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  testId,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  testId: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      className="flex h-7 w-[25px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  )
}
