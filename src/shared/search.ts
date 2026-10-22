import type { SearchMatch, SearchOptions } from '@shared/ipc'

/**
 * Pure project-wide search engine (shared between main and renderer so open
 * tabs and on-disk files are matched identically).
 */

const TEXT_EXTENSIONS = new Set([
  'tex',
  'ltx',
  'sty',
  'cls',
  'bib',
  'txt',
  'md',
  'csv',
  'tikz',
  'dtx',
  'ins',
  'cfg',
  'json',
])

export function isSearchableFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext !== undefined && TEXT_EXTENSIONS.has(ext)
}

/** Build a RegExp from the query and options; returns null for invalid regex. */
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  let source: string
  if (options.regex) {
    try {
      new RegExp(query) // validate
      source = query
    } catch {
      return null
    }
  } else {
    source = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  if (options.wholeWord) {
    source = `(?<![\\w])${source}(?![\\w])`
  }
  const flags = options.caseSensitive ? 'g' : 'gi'
  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

export function searchInText(text: string, regex: RegExp, maxPreviewLength = 160): SearchMatch[] {
  const matches: SearchMatch[] = []
  const lines = text.split('\n')
  let offset = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(line)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++
        continue
      }
      matches.push({
        line: lineIndex + 1,
        column: match.index + 1,
        length: match[0].length,
        preview: line.slice(0, maxPreviewLength),
      })
      if (matches.length >= 1000) return matches
    }
    offset += line.length + 1
  }
  void offset
  return matches
}

export function replaceInText(
  text: string,
  regex: RegExp,
  replacement: string
): { text: string; count: number } {
  regex.lastIndex = 0
  const matches = text.match(regex)
  const count = matches ? matches.length : 0
  // Reset regex state — global regexes are stateful.
  regex.lastIndex = 0
  return { text: text.replace(regex, replacement), count }
}
