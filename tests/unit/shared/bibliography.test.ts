import { describe, expect, it } from 'vitest'
import {
  citationReport,
  escapeLatex,
  findDuplicates,
  findMathRange,
  generateCiteKey,
  generateTable,
  parseTable,
  normalizeTitle,
} from '../../../src/shared/latex/bibliography'

describe('generateCiteKey', () => {
  it('builds authorYearFirstword keys', () => {
    expect(generateCiteKey({ author: 'Donald E. Knuth', year: '1984', title: 'The TeXbook' })).toBe(
      'knuth1984texbook'
    )
  })

  it('handles multiple authors and missing fields', () => {
    expect(
      generateCiteKey({ author: 'A. Smith and B. Jones', year: '2001', title: 'Something' })
    ).toBe('smith2001something')
    expect(generateCiteKey({})).toBe('unknown')
  })
})

describe('duplicate detection', () => {
  it('groups entries with the same DOI', () => {
    const groups = findDuplicates([
      { key: 'a', type: 'article', doi: '10.1000/x', source: '' },
      { key: 'b', type: 'article', doi: 'https://doi.org/10.1000/x', source: '' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].keys).toEqual(['a', 'b'])
    expect(groups[0].reason).toBe('doi')
  })

  it('groups entries with the same normalized title', () => {
    const groups = findDuplicates([
      { key: 'a', type: 'article', title: 'The {TeX}book', source: '' },
      { key: 'b', type: 'book', title: 'The TeXbook', source: '' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].reason).toBe('title')
  })

  it('ignores short titles', () => {
    expect(
      findDuplicates([
        { key: 'a', type: 'misc', title: 'Note', source: '' },
        { key: 'b', type: 'misc', title: 'Note', source: '' },
      ])
    ).toHaveLength(0)
  })

  it('normalizes titles deterministically', () => {
    expect(normalizeTitle('The {TeX}book!')).toBe(normalizeTitle('the TeXbook'))
  })
})

describe('citation report', () => {
  it('reports unused and missing keys', () => {
    const report = citationReport(
      [
        { key: 'knuth1984', type: 'book', source: '' },
        { key: 'unused1', type: 'article', source: '' },
      ],
      ['knuth1984', 'ghost2020']
    )
    expect(report.unused).toEqual(['unused1'])
    expect(report.missing).toEqual(['ghost2020'])
  })
})

describe('LaTeX escaping', () => {
  it('escapes special characters', () => {
    expect(escapeLatex('100% & $x^2 #1_a ~b {c} \\d')).toBe(
      '100\\% \\& \\$x\\textasciicircum{}2 \\#1\\_a \\textasciitilde{}b \\{c\\} \\textbackslash{}d'
    )
  })
})

describe('table generator', () => {
  it('generates a booktabs table with caption', () => {
    const latex = generateTable({
      rows: [
        ['Condition', 'Mean'],
        ['A', '3.4'],
      ],
      alignments: ['l', 'r'],
      headerRow: true,
      booktabs: true,
      caption: 'Results',
      label: 'tab:results',
      fullWidth: false,
      floatPosition: 'ht',
    })
    expect(latex).toContain('\\begin{table}[ht]')
    expect(latex).toContain('\\begin{tabular}{lr}')
    expect(latex).toContain('\\toprule')
    expect(latex).toContain('Condition & Mean \\\\')
    expect(latex).toContain('\\bottomrule')
    expect(latex).toContain('\\caption{Results}')
    expect(latex).toContain('\\label{tab:results}')
    expect(latex).toContain('\\end{table}')
  })

  it('escapes cell content', () => {
    const latex = generateTable({
      rows: [['A & B']],
      alignments: ['l'],
      headerRow: false,
      booktabs: false,
      caption: '',
      label: '',
      fullWidth: false,
      floatPosition: 'ht',
    })
    expect(latex).toContain('A \\& B')
  })

  it('generates tabularx for full width', () => {
    const latex = generateTable({
      rows: [['a']],
      alignments: ['l'],
      headerRow: false,
      booktabs: true,
      caption: '',
      label: '',
      fullWidth: true,
      floatPosition: 'ht',
    })
    expect(latex).toContain('\\begin{tabularx}{\\linewidth}')
  })
})

describe('table parser round-trip', () => {
  it('round-trips a simple booktabs table', () => {
    const original = generateTable({
      rows: [
        ['Condition', 'Mean'],
        ['A', '3.4'],
      ],
      alignments: ['l', 'r'],
      headerRow: true,
      booktabs: true,
      caption: 'Results',
      label: 'tab:results',
      fullWidth: false,
      floatPosition: 'ht',
    })
    const grid = parseTable(original)
    expect(grid).not.toBeNull()
    expect(grid!.rows).toHaveLength(2)
    expect(grid!.rows[0]).toEqual(['Condition', 'Mean'])
    expect(grid!.alignments).toEqual(['l', 'r'])
    expect(grid!.booktabs).toBe(true)
    expect(grid!.caption).toBe('Results')
    // Re-generating yields the same output.
    expect(generateTable(grid!)).toBe(original)
  })

  it('returns null for non-tables', () => {
    expect(parseTable('\\section{Hello}')).toBeNull()
  })
})

describe('math range detection', () => {
  it('finds inline math', () => {
    const text = 'before $x^2 + y_1$ after'
    const range = findMathRange(text, text.indexOf('^'))
    expect(range).toEqual({ start: 7, end: 18, display: false, latex: 'x^2 + y_1' })
  })

  it('finds display math', () => {
    const text = 'text \\[\\int_0^1 f\\] end'
    const range = findMathRange(text, text.indexOf('int'))
    expect(range?.display).toBe(true)
    expect(range?.latex).toBe('\\int_0^1 f')
  })

  it('finds equation environments', () => {
    const text = '\\begin{equation}\n  E = mc^2\n\\end{equation}'
    const range = findMathRange(text, text.indexOf('mc'))
    expect(range?.display).toBe(true)
    expect(range?.latex).toContain('E = mc^2')
  })

  it('returns null outside math', () => {
    expect(findMathRange('plain text', 3)).toBeNull()
  })
})
