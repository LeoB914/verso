/**
 * Pure helpers for inserting citations at the editor cursor (unit-tested,
 * DOM-free). All positions are 0-based columns within a single line.
 */

export interface CitationInsertion {
  /** Replace [from, to) within the line with `text`. */
  from: number
  to: number
  text: string
}

/** Commands Verso offers for inserting citations. */
export const CITE_COMMANDS = [
  'cite',
  'parencite',
  'textcite',
  'autocite',
  'citep',
  'citet',
] as const

export type CiteCommand = (typeof CITE_COMMANDS)[number]

/** Matches \cite{, \parencite{, \citep*{, … (biblatex + natbib commands). */
const CITE_COMMAND_RE = /\\[a-zA-Z]*cite[a-zA-Z]*\*?\{/g

/**
 * True when `column` sits inside the key list of a \cite-like command on this
 * line (after its opening brace, before the closing brace).
 */
export function isInsideCiteList(lineText: string, column: number): boolean {
  CITE_COMMAND_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CITE_COMMAND_RE.exec(lineText)) !== null) {
    const brace = match.index + match[0].length
    const close = lineText.indexOf('}', brace)
    if (column >= brace && (close === -1 || column <= close)) return true
  }
  return false
}

/**
 * Build the insertion for a citation at the cursor.
 *
 * - Inside a cite key list (`\cite{a, b|}`): append to the list, avoiding
 *   doubled or missing commas.
 * - Otherwise: insert the full `\command{key}` at the cursor.
 */
export function citationInsertion(
  lineText: string,
  column: number,
  command: string,
  key: string
): CitationInsertion {
  const safeColumn = Math.max(0, Math.min(column, lineText.length))

  if (isInsideCiteList(lineText, safeColumn)) {
    const before = lineText.slice(0, safeColumn)
    if (before.endsWith(',') || before.endsWith('{')) {
      // Right after a separator: plain key, no comma needed.
      return { from: safeColumn, to: safeColumn, text: key }
    }
    return { from: safeColumn, to: safeColumn, text: `,${key}` }
  }

  // Plain insertion of the full command at the cursor.
  return { from: safeColumn, to: safeColumn, text: `\\${command}{${key}}` }
}
