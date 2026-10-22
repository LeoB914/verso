import { describe, expect, it } from 'vitest'
import { buildVisualTasks, collectMathRanges } from '../../../src/shared/latex/visual'

type ReplaceTask = Extract<ReturnType<typeof buildVisualTasks>[number], { type: 'replace' }>

function tasksOf(text: string, cursor: number): ReturnType<typeof buildVisualTasks> {
  return buildVisualTasks(text, { selectionFrom: cursor, selectionTo: cursor })
}

function replaceTasks(tasks: ReturnType<typeof buildVisualTasks>): ReplaceTask[] {
  return tasks.filter((t): t is ReplaceTask => t.type === 'replace')
}

describe('visual decoration tasks', () => {
  it('renders sections as heading chips', () => {
    const text = '\\section{Introduction}\nBody text.'
    const tasks = tasksOf(text, text.length)
    const chip = tasks.find(
      (t) =>
        t.type === 'replace' &&
        t.widget.kind === 'chip' &&
        'label' in t.widget &&
        t.widget.label === 'Introduction'
    )
    expect(chip).toBeDefined()
    expect(tasks.some((t) => t.type === 'line' && t.className.includes('heading-2'))).toBe(true)
  })

  it('reveals sections near the cursor', () => {
    const text = '\\section{Introduction}\nBody text.'
    const tasks = tasksOf(text, 5)
    expect(tasks.some((t) => t.type === 'replace' && t.widget.kind === 'chip')).toBe(false)
    // The line class remains for styling.
    expect(tasks.some((t) => t.type === 'line')).toBe(true)
  })

  it('hides formatting commands and marks the content', () => {
    const text = 'A \\textbf{bold} word.'
    const tasks = tasksOf(text, text.length)
    const hidden = tasks.filter(
      (t) =>
        t.type === 'replace' &&
        t.widget.kind === 'chip' &&
        'chipKind' in t.widget &&
        t.widget.chipKind === 'hidden'
    )
    expect(hidden).toHaveLength(2) // `\textbf{` and `}`
    const mark = tasks.find((t) => t.type === 'mark' && t.className === 'openleaf-bold')
    expect(mark).toMatchObject({ from: text.indexOf('bold'), to: text.indexOf('bold') + 4 })
  })

  it('keeps formatting commands visible at the cursor', () => {
    const text = 'A \\textbf{bold} word.'
    const tasks = tasksOf(text, text.indexOf('bold'))
    expect(
      tasks.filter(
        (t) => t.type === 'replace' && 'chipKind' in t.widget && t.widget.chipKind === 'hidden'
      )
    ).toHaveLength(0)
    expect(tasks.some((t) => t.type === 'mark' && t.className === 'openleaf-bold')).toBe(true)
  })

  it('renders itemize bullets', () => {
    const text = '\\begin{itemize}\n\\item One\n\\item Two\n\\end{itemize}'
    const tasks = tasksOf(text, text.length)
    const bullets = tasks.filter(
      (t) =>
        t.type === 'replace' &&
        t.widget.kind === 'chip' &&
        'chipKind' in t.widget &&
        t.widget.chipKind === 'item'
    )
    expect(bullets).toHaveLength(2)
  })

  it('collapses begin/end into labels', () => {
    const text = '\\begin{center}\nX\n\\end{center}'
    const tasks = tasksOf(text, text.length)
    const labels = replaceTasks(tasks).filter((t) => t.widget.kind === 'label')
    expect(labels.some((l) => 'text' in l.widget && l.widget.text === '⟨center⟩')).toBe(true)
    expect(labels.some((l) => 'text' in l.widget && l.widget.text === '⟨/center⟩')).toBe(true)
  })

  it('renders citations as chips with bib labels', () => {
    const text = 'As shown \\cite{knuth1984} before.'
    const tasks = buildVisualTasks(text, {
      selectionFrom: text.length,
      selectionTo: text.length,
      bibLabels: { knuth1984: 'Knuth 1984' },
    })
    const chip = tasks.find(
      (t) =>
        t.type === 'replace' &&
        t.widget.kind === 'chip' &&
        'chipKind' in t.widget &&
        t.widget.chipKind === 'cite'
    )
    expect(chip).toMatchObject({ widget: { label: 'Knuth 1984' } })
  })

  it('renders math with the injected KaTeX renderer', () => {
    const text = 'Math $x^2$ here.'
    const tasks = buildVisualTasks(text, {
      selectionFrom: text.length,
      selectionTo: text.length,
      renderMath: (latex) => `<data>${latex}</data>`,
    })
    const math = replaceTasks(tasks).find((t) => t.widget.kind === 'math')
    expect(math).toMatchObject({ widget: { latex: 'x^2', html: '<data>x^2</data>' } })
  })

  it('collapses the preamble', () => {
    const text =
      '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nHi\n\\end{document}'
    const tasks = tasksOf(text, text.length)
    const preamble = replaceTasks(tasks).find(
      (t) => t.widget.kind === 'label' && t.widget.text === '▼ Preamble'
    )
    expect(preamble).toBeDefined()
    // Preamble is replaced up to the line end after \begin{document}.
    expect(preamble!.to).toBeGreaterThan(text.indexOf('\\begin{document}'))
  })

  it('dim-marks comments', () => {
    const text = 'Visible % hidden comment'
    const tasks = tasksOf(text, text.length)
    expect(tasks.some((t) => t.type === 'mark' && t.className === 'openleaf-comment')).toBe(true)
  })
})

describe('collectMathRanges', () => {
  it('finds inline and display math across a document', () => {
    const text = '$a$ and \\[b\\] and $c$'
    const ranges = collectMathRanges(text)
    expect(ranges).toHaveLength(3)
    expect(ranges.some((r) => r.display && r.latex === 'b')).toBe(true)
    expect(
      ranges
        .filter((r) => !r.display)
        .map((r) => r.latex)
        .sort()
    ).toEqual(['a', 'c'])
  })
})

describe('performance', () => {
  it('builds decorations for a 5000-line document in under 300 ms', () => {
    const lines: string[] = []
    for (let i = 0; i < 1250; i++) {
      lines.push(
        `\\section{Section ${i}}`,
        'Some \\textbf{bold} text with $x^2$ and \\cite{key}.',
        '',
        '\\begin{itemize}\\item x\\end{itemize}',
        ''
      )
    }
    const text = lines.join('\n')
    expect(text.split('\n').length).toBeGreaterThanOrEqual(5000)
    const start = performance.now()
    const tasks = tasksOf(text, 0)
    const duration = performance.now() - start
    expect(tasks.length).toBeGreaterThan(1000)
    expect(duration).toBeLessThan(300)
  })
})

describe('round-trip guarantee', () => {
  it('tasks never mutate the document text', () => {
    const text = '\\section{A}\n\\textbf{B} $C$ \\cite{d}\n'
    const original = text
    tasksOf(text, 0)
    expect(text).toBe(original)
  })
})
