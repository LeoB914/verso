/**
 * Bibliography service (pure helpers on top of the built-in bib parser):
 * key generation, duplicate detection, unused/missing report and .bib
 * cleanup normalization.
 */

export interface BibEntryLite {
  key: string
  type: string
  author?: string
  title?: string
  year?: string
  doi?: string
  /** Raw BibTeX source of the entry. */
  source: string
  /** 1-based line in the source file (References panel jump target). */
  line?: number
}

/** Generate a citation key: authorYearFirstword (e.g. `knuth1984TeXbook`). */
export function generateCiteKey(entry: { author?: string; year?: string; title?: string }): string {
  const author =
    (entry.author ?? 'unknown')
      .split(/\s+and\s+/i)[0]
      .split(',')[0]
      .split(/\s+/)
      .pop() ?? 'unknown'
  const cleanAuthor = author.replace(/[^A-Za-z]/g, '')
  const year = (entry.year ?? '').replace(/[^0-9]/g, '').slice(0, 4)
  const stopWords = new Set(['the', 'a', 'an', 'on', 'of', 'in', 'and'])
  const firstWord =
    (entry.title ?? '')
      .replace(/[{}\\]/g, '')
      .split(/\s+/)
      .filter((word) => /[A-Za-z]/.test(word) && !stopWords.has(word.toLowerCase()))
      .find(Boolean) ?? ''
  const cleanWord = firstWord.replace(/[^A-Za-z]/g, '')
  return `${cleanAuthor.toLowerCase()}${year}${cleanWord.toLowerCase()}`
}

/** Normalize a title for duplicate detection (strip braces, commands, case). */
export function normalizeTitle(title: string): string {
  return title
    .replace(/[{}\\]/g, '')
    .replace(/[^A-Za-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export interface DuplicateGroup {
  keys: string[]
  reason: 'doi' | 'title'
}

/** Detect duplicates by DOI or normalized title. */
export function findDuplicates(entries: BibEntryLite[]): DuplicateGroup[] {
  const byDoi = new Map<string, string[]>()
  const byTitle = new Map<string, string[]>()
  for (const entry of entries) {
    if (entry.doi) {
      const doi = entry.doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
      byDoi.set(doi, [...(byDoi.get(doi) ?? []), entry.key])
    }
    if (entry.title) {
      const title = normalizeTitle(entry.title)
      if (title.length > 10) {
        byTitle.set(title, [...(byTitle.get(title) ?? []), entry.key])
      }
    }
  }
  const groups: DuplicateGroup[] = []
  for (const keys of byDoi.values()) {
    if (keys.length > 1) groups.push({ keys, reason: 'doi' })
  }
  for (const keys of byTitle.values()) {
    if (keys.length > 1 && !groups.some((g) => g.keys.includes(keys[0]))) {
      groups.push({ keys, reason: 'title' })
    }
  }
  return groups
}

export interface CitationReport {
  /** Entries defined in .bib files but never cited. */
  unused: string[]
  /** Cited keys without a matching entry. */
  missing: string[]
}

/** Compare defined entries against the citations used in .tex files. */
export function citationReport(entries: BibEntryLite[], citedKeys: string[]): CitationReport {
  const defined = new Set(entries.map((entry) => entry.key))
  const cited = new Set(citedKeys)
  return {
    unused: [...defined].filter((key) => !cited.has(key)).sort(),
    missing: [...cited].filter((key) => !defined.has(key)).sort(),
  }
}

/** Escape LaTeX special characters in cell text. */
export function escapeLatex(text: string): string {
  const BACKSLASH = '\u0000BS\u0000'
  return text
    .replace(/\\/g, BACKSLASH)
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .split(BACKSLASH)
    .join('\\textbackslash{}')
}

export interface TableGrid {
  rows: string[][]
  /** Column alignment: l, c, r, or p{width}. */
  alignments: Array<'l' | 'c' | 'r' | string>
  headerRow: boolean
  booktabs: boolean
  caption: string
  label: string
  fullWidth: boolean
  floatPosition: string
}

/** Generate the LaTeX table code from a grid. */
export function generateTable(grid: TableGrid): string {
  const alignment = grid.alignments.map((a) => (a.startsWith('p') ? a : a)).join('')
  const columnSpec = grid.fullWidth ? `@{}p{\\linewidth}@{}` : alignment
  const rowSep = grid.booktabs ? '    \\midrule' : '    \\hline'

  const escapeRow = (row: string[]): string =>
    '    ' + row.map((cell) => escapeLatex(cell)).join(' & ') + ' \\\\'

  const lines: string[] = []
  if (grid.caption) {
    lines.push(`\\begin{table}[${grid.floatPosition || 'ht'}]`)
    lines.push('  \\centering')
  }
  if (grid.fullWidth) {
    lines.push(`\\begin{tabularx}{\\linewidth}{${columnSpec}}`)
  } else {
    lines.push(`\\begin{tabular}{${columnSpec}}`)
  }
  lines.push(grid.booktabs ? '    \\toprule' : '    \\hline')
  const bodyRows = grid.headerRow ? grid.rows.slice(1) : grid.rows
  if (grid.headerRow && grid.rows.length > 0) {
    lines.push(escapeRow(grid.rows[0]))
    lines.push(rowSep)
  }
  for (const row of bodyRows) {
    lines.push(escapeRow(row))
  }
  lines.push(grid.booktabs ? '    \\bottomrule' : '    \\hline')
  lines.push(grid.fullWidth ? '\\end{tabularx}' : '\\end{tabular}')
  if (grid.caption) {
    lines.push(`  \\caption{${escapeLatex(grid.caption)}}`)
    if (grid.label) lines.push(`  \\label{${grid.label}}`)
    lines.push('\\end{table}')
  }
  return lines.join('\n')
}

/**
 * Parse a simple tabular back into a grid. Returns null when the table is too
 * complex (nested environments, \\multicolumn with column spans etc. are kept
 * as raw cell text).
 */
export function parseTable(latex: string): TableGrid | null {
  const begin = /\\begin\{tabular\*?\}(\{[^}]*\})?\{([^}]*)\}/.exec(latex)
  if (!begin) return null
  const alignments = (begin[2] ?? '')
    .replace(/[|@\s]/g, '')
    .split('')
    .filter((c) => ['l', 'c', 'r'].includes(c) || c.startsWith('p'))
  if (alignments.length === 0) return null

  const end = latex.indexOf('\\end{tabular*?}'.replace('*?', ''), begin.index)
  const body = latex.slice(begin.index + begin[0].length, end === -1 ? latex.length : end)

  const rows: string[][] = []
  for (const rawLine of body.split(/\\\\/)) {
    const line = rawLine.replace(/\\(toprule|midrule|bottomrule|hline|cline\{[^}]*\})/g, '').trim()
    if (!line) continue
    if (/\\multicolumn\{(\d+)\}/.test(line)) {
      // Keep raw cell text; do not attempt column accounting.
      rows.push([line.replace(/\\multicolumn\{\d+\}\{[^}]*\}/, '').trim()])
      continue
    }
    const cells = line.split('&').map((cell) => cell.trim())
    rows.push(cells)
  }
  if (rows.length === 0) return null

  const headerRow = /\\(toprule|midrule)/.test(latex) && rows.length > 1
  const booktabs = /\\toprule/.test(latex)
  return {
    rows,
    alignments: alignments as TableGrid['alignments'],
    headerRow,
    booktabs,
    caption: /\\caption\{([^}]*)\}/.exec(latex)?.[1] ?? '',
    label: /\\label\{([^}]*)\}/.exec(latex)?.[1] ?? '',
    fullWidth: /\\begin\{tabularx\}/.test(latex),
    floatPosition: /\\begin\{table}\[(\w+)\]/.exec(latex)?.[1] ?? 'ht',
  }
}

/** Math range detection for hover previews. */
export interface MathRange {
  start: number
  end: number
  display: boolean
  latex: string
}

/** Find the math region containing `pos`, or null. */
export function findMathRange(text: string, pos: number): MathRange | null {
  // Environments first.
  const envRe =
    /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)\}([\s\S]*?)\\end\{\1\}/g
  let match: RegExpExecArray | null
  while ((match = envRe.exec(text)) !== null) {
    if (pos >= match.index && pos <= match.index + match[0].length) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        display: true,
        latex: match[2],
      }
    }
  }
  // \[...\] display math.
  const displayRe = /\\\[([\s\S]*?)\\\]/g
  while ((match = displayRe.exec(text)) !== null) {
    if (pos >= match.index && pos <= match.index + match[0].length) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        display: true,
        latex: match[1],
      }
    }
  }
  // $...$ inline (skip $$).
  let i = 0
  let mathStart = -1
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text.startsWith('$$', i)) {
      const close = text.indexOf('$$', i + 2)
      if (close === -1) break
      if (pos >= i && pos <= close + 2) {
        return { start: i, end: close + 2, display: true, latex: text.slice(i + 2, close) }
      }
      i = close + 2
      continue
    }
    if (text[i] === '$') {
      if (mathStart === -1) mathStart = i
      else {
        if (pos >= mathStart && pos <= i) {
          return {
            start: mathStart,
            end: i + 1,
            display: false,
            latex: text.slice(mathStart + 1, i),
          }
        }
        mathStart = -1
      }
    }
    i++
  }
  return null
}
