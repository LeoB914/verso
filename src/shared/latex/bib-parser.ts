/**
 * Minimal BibTeX/BibLaTeX `.bib` parser (pure). Extracts entry type, key and
 * fields — enough for autocomplete tooltips and the citation helper; the full
 * bibliography manager is Phase 7.
 */

export interface BibEntry {
  type: string
  key: string
  fields: Record<string, string>
  /** 1-based line where the entry starts. */
  line: number
}

export function parseBibFile(text: string): BibEntry[] {
  const entries: BibEntry[] = []
  let i = 0

  while (i < text.length) {
    const at = text.indexOf('@', i)
    if (at === -1) break
    // Skip @comment / @preamble / @string.
    const brace = text.indexOf('{', at)
    if (brace === -1) break
    const type = text
      .slice(at + 1, brace)
      .trim()
      .toLowerCase()
    if (['comment', 'preamble', 'string'].includes(type)) {
      i = skipBraceGroup(text, brace)
      continue
    }
    const comma = text.indexOf(',', brace)
    if (comma === -1 || comma > skipBraceGroup(text, brace)) {
      i = brace
      continue
    }
    const key = text.slice(brace + 1, comma).trim()
    const fields: Record<string, string> = {}
    let cursor = comma + 1
    const groupEnd = skipBraceGroup(text, brace)

    while (cursor < groupEnd) {
      const eq = text.indexOf('=', cursor)
      if (eq === -1 || eq >= groupEnd) break
      const fieldName = text.slice(cursor, eq).trim().toLowerCase()
      let valueStart = eq + 1
      while (valueStart < groupEnd && /\s/.test(text[valueStart])) valueStart++
      let value = ''
      if (text[valueStart] === '{') {
        const end = skipBraceGroup(text, valueStart)
        value = text.slice(valueStart + 1, end - 1)
        cursor = end
      } else if (text[valueStart] === '"') {
        let end = valueStart + 1
        while (end < text.length) {
          if (text[end] === '{') {
            end = skipBraceGroup(text, end)
            continue
          }
          if (text[end] === '"') break
          end++
        }
        value = text.slice(valueStart + 1, end)
        cursor = end + 1
      } else {
        let end = valueStart
        while (end < groupEnd && /[^,\s}]/.test(text[end])) end++
        value = text.slice(valueStart, end)
        cursor = end
      }
      fields[fieldName] = cleanBibValue(value)
      // Advance to the next comma or the end.
      const nextComma = text.indexOf(',', cursor)
      cursor = nextComma === -1 || nextComma >= groupEnd ? groupEnd : nextComma + 1
    }

    entries.push({
      type,
      key,
      fields,
      line: text.slice(0, at).split('\n').length,
    })
    i = groupEnd
  }

  return entries
}

function skipBraceGroup(text: string, openBrace: number): number {
  let depth = 0
  let i = openBrace
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    } else if (ch === '"') {
      // Skip quoted strings so braces inside quotes don't count.
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '{') {
          i = skipBraceGroup(text, i)
          continue
        }
        i++
      }
    }
    i++
  }
  return text.length
}

/** Strip LaTeX cruft from a field value for display. */
export function cleanBibValue(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

/** Short human-readable description: "Author (Year): Title". */
export function bibEntrySummary(entry: BibEntry): string {
  const author = entry.fields.author ?? entry.fields.editor ?? ''
  const year = entry.fields.year ?? ''
  const title = entry.fields.title ?? ''
  const parts: string[] = []
  if (author) parts.push(lastAuthors(author, 2))
  if (year) parts.push(`(${year})`)
  const prefix = parts.join(' ')
  return title ? (prefix ? `${prefix}: ${title}` : title) : prefix || entry.key
}

function lastAuthors(author: string, max: number): string {
  const names = author.split(/\s+and\s+/i)
  const short = names.slice(0, max).map((n) => n.trim().split(',').reverse().join(' ').trim())
  if (names.length > max) short.push('et al.')
  return short.join('; ')
}
