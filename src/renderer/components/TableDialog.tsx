import { useMemo, useState } from 'react'
import { generateTable, escapeLatex, type TableGrid } from '@shared/latex/bibliography'
import { invokeOrThrow } from '../api'
import { useEditorStore } from '../stores/editor'

/**
 * Table assistant: spreadsheet-like grid → LaTeX table with live preview.
 * Paste CSV/TSV, choose alignment/booktabs/caption, insert at the cursor.
 */

interface TableDialogProps {
  open: boolean
  onClose: () => void
}

export function TableDialog({ open, onClose }: TableDialogProps): React.JSX.Element | null {
  const [grid, setGrid] = useState<TableGrid>({
    rows: [
      ['Column A', 'Column B', 'Column C'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ],
    alignments: ['l', 'c', 'r'],
    headerRow: true,
    booktabs: true,
    caption: '',
    label: 'tab:example',
    fullWidth: false,
    floatPosition: 'ht',
  })
  const [insertPackages, setInsertPackages] = useState(true)

  const latex = useMemo(() => generateTable(grid), [grid])

  const setCell = (row: number, col: number, value: string): void => {
    setGrid((g) => {
      const rows = g.rows.map((r) => [...r])
      rows[row][col] = value
      return { ...g, rows }
    })
  }

  const addRow = (): void => setGrid((g) => ({ ...g, rows: [...g.rows, g.rows[0].map(() => '')] }))
  const removeRow = (index: number): void =>
    setGrid((g) => ({ ...g, rows: g.rows.filter((_, i) => i !== index) }))
  const addColumn = (): void =>
    setGrid((g) => ({
      ...g,
      rows: g.rows.map((r) => [...r, '']),
      alignments: [...g.alignments, 'c'],
    }))
  const removeColumn = (): void =>
    setGrid((g) => ({
      ...g,
      rows: g.rows.map((r) => r.slice(0, -1)),
      alignments: g.alignments.slice(0, -1),
    }))

  const pasteGrid = (text: string): void => {
    const rows = text
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(/\t|,/).map((cell) => cell.trim()))
    if (rows.length > 0 && rows[0].length > 0) {
      setGrid((g) => ({
        ...g,
        rows,
        alignments: rows[0].map(() => 'c'),
      }))
    }
  }

  const insert = async (): Promise<void> => {
    const editor = useEditorStore.getState()
    const tab = editor.tabs.find((t) => t.relPath === editor.activePath)
    if (!tab || tab.readOnly) return
    let code = latex
    if (insertPackages) {
      const needs = []
      if (grid.booktabs && !tab.content.includes('{booktabs}')) needs.push('\\usepackage{booktabs}')
      if (grid.fullWidth && !tab.content.includes('{tabularx}'))
        needs.push('\\usepackage{tabularx}')
      if (needs.length > 0) {
        code = needs.join('\n') + '\n\n' + code
      }
    }
    editor.updateContent(tab.relPath, tab.content + '\n\n' + code)
    onClose()
  }

  if (!open) return null

  const cols = grid.rows[0]?.length ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[760px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-popover)]"
        onClick={(e) => e.stopPropagation()}
        data-testid="table-dialog"
      >
        <h2 className="mb-3 text-[16px] font-semibold">Insert table</h2>

        <div className="mb-2 flex items-center gap-2 text-[13px]">
          <button
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5"
            onClick={addRow}
          >
            + Row
          </button>
          <button
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5"
            onClick={addColumn}
          >
            + Column
          </button>
          <button
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5"
            onClick={() => removeRow(grid.rows.length - 1)}
          >
            − Row
          </button>
          <button
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5"
            onClick={removeColumn}
            disabled={cols <= 1}
          >
            − Column
          </button>
          <label className="ml-2 flex items-center gap-1">
            <input
              type="checkbox"
              checked={grid.booktabs}
              onChange={(e) => setGrid({ ...grid, booktabs: e.target.checked })}
            />
            booktabs
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={grid.headerRow}
              onChange={(e) => setGrid({ ...grid, headerRow: e.target.checked })}
            />
            Header row
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={grid.fullWidth}
              onChange={(e) => setGrid({ ...grid, fullWidth: e.target.checked })}
            />
            Full width (tabularx)
          </label>
        </div>

        {/* Grid */}
        <div
          className="mb-3 overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]"
          onPaste={(e) => {
            const text = e.clipboardData.getData('text/plain')
            if (text.includes('\t') || text.includes(',')) {
              e.preventDefault()
              pasteGrid(text)
            }
          }}
        >
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                {grid.alignments.map((alignment, col) => (
                  <th key={col} className="border-b border-[var(--border-subtle)] p-1">
                    <select
                      className="w-full bg-transparent text-center text-[11px]"
                      value={alignment}
                      onChange={(e) =>
                        setGrid((g) => ({
                          ...g,
                          alignments: g.alignments.map((a, i) => (i === col ? e.target.value : a)),
                        }))
                      }
                    >
                      <option value="l">l</option>
                      <option value="c">c</option>
                      <option value="r">r</option>
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, colIndex) => (
                    <td key={colIndex} className="border-b border-[var(--border-subtle)]/50 p-0">
                      <input
                        className="w-full bg-transparent px-2 py-1 outline-none focus:bg-[var(--bg-selected)]"
                        value={escapeLatex(cell) === cell ? cell : cell}
                        onChange={(e) => setCell(rowIndex, colIndex, e.target.value)}
                        data-testid={`cell-${rowIndex}-${colIndex}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mb-3 flex gap-3 text-[13px]">
          <label className="flex items-center gap-1">
            <span className="text-[var(--text-secondary)]">Caption</span>
            <input
              className="h-7 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
              value={grid.caption}
              onChange={(e) => setGrid({ ...grid, caption: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-[var(--text-secondary)]">Label</span>
            <input
              className="h-24 w-32 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
              value={grid.label}
              onChange={(e) => setGrid({ ...grid, label: e.target.value })}
            />
          </label>
        </div>

        {/* Live preview */}
        <div
          className="mb-3 min-h-24 flex-1 overflow-auto rounded-[var(--radius-md)] bg-[var(--bg-content)] p-2 font-mono text-[12px]"
          data-testid="table-preview"
        >
          <pre className="whitespace-pre-wrap">{latex}</pre>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-1.5 text-[13px] font-medium text-[var(--accent-contrast)]"
            onClick={() => void insert()}
            data-testid="insert-table"
          >
            Insert at cursor
          </button>
          <label className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={insertPackages}
              onChange={(e) => setInsertPackages(e.target.checked)}
            />
            Add missing \\usepackage lines
          </label>
          <div className="flex-1" />
          <button
            className="text-[13px] text-[var(--text-secondary)] hover:underline"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

void invokeOrThrow
