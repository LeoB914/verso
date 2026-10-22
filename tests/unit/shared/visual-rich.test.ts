import { describe, expect, it } from 'vitest'
import { buildVisualTasks } from '@shared/latex/visual'

const context = {
  selectionFrom: 99999,
  selectionTo: 99999,
  resolveImage: (p: string) => `${p}.png`,
}

describe('visual rich widgets', () => {
  it('renders figures with image, caption, label and width', () => {
    const text = [
      '\\begin{figure}[ht]',
      '\\includegraphics[width=0.5\\linewidth]{figures/x}',
      '\\caption{A caption}',
      '\\label{fig:x}',
      '\\end{figure}',
    ].join('\n')
    const task = buildVisualTasks(text, context).find(
      (t) => t.type === 'replace' && t.widget.kind === 'figure'
    )
    expect(task).toBeDefined()
    if (task?.type === 'replace' && task.widget.kind === 'figure') {
      expect(task.widget.src).toBe('figures/x.png')
      expect(task.widget.caption).toBe('A caption')
      expect(task.widget.label).toBe('fig:x')
      expect(task.widget.width).toBe('50%')
    }
  })

  it('renders tabular rows and footnotes', () => {
    const text =
      '\\begin{table}\n\\begin{tabular}{ll}\nA & B\\\\\n1 & 2\\\\\n\\end{tabular}\n\\end{table}\nText\\footnote{Note}.'
    const tasks = buildVisualTasks(text, context)
    const table = tasks.find((t) => t.type === 'replace' && t.widget.kind === 'table')
    expect(table).toBeDefined()
    if (table?.type === 'replace' && table.widget.kind === 'table') {
      expect(table.widget.rows[0]).toEqual(['A', 'B'])
    }
    const footnote = tasks.find((t) => t.type === 'replace' && t.widget.kind === 'footnote')
    expect(footnote).toBeDefined()
    if (footnote?.type === 'replace' && footnote.widget.kind === 'footnote') {
      expect(footnote.widget.text).toBe('Note')
    }
  })
})
