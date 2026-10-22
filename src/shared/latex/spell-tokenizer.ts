/**
 * Spellcheck tokenizer (pure): decides which ranges of a LaTeX document are
 * prose to be spell-checked. Skips commands, their non-text arguments, math,
 * comments, verbatim regions and punctuation.
 */

export interface ProseRange {
  word: string
  start: number
  end: number
}

const NON_TEXT_COMMAND_ARGS = new Set([
  'ref',
  'eqref',
  'autoref',
  'cref',
  'Cref',
  'pageref',
  'vref',
  'label',
  'cite',
  'citep',
  'citet',
  'citeauthor',
  'citeyear',
  'parencite',
  'textcite',
  'autocite',
  'footcite',
  'fullcite',
  'nocite',
  'usepackage',
  'documentclass',
  'includegraphics',
  'input',
  'include',
  'subfile',
  'bibliography',
  'addbibresource',
  'bibliographystyle',
  'begin',
  'end',
  'newcommand',
  'renewcommand',
  'providecommand',
  'setlength',
  'addtolength',
  'setcounter',
  'addtocounter',
  'value',
  'hspace',
  'vspace',
  'includeonly',
  'graphicspath',
  'usetikzlibrary',
  'lstset',
  'hypersetup',
  'definecolor',
  'textcolor',
  'color',
  'url',
  'href',
  'nolinkurl',
  'bibliographystyle',
])

const TEXT_COMMANDS = new Set([
  'textbf',
  'textit',
  'texttt',
  'textsc',
  'textsf',
  'textrm',
  'emph',
  'underline',
  'textnormal',
  'textsl',
  'textup',
  'text',
  'mbox',
  'textsuperscript',
  'textsubscript',
])

const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿßẞ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿßẞ]+)*/g

export function findProseRanges(
  text: string,
  commentRanges: Array<{ start: number; end: number }>,
  verbatimRanges: Array<{ start: number; end: number }>
): ProseRange[] {
  const excluded: Array<{ start: number; end: number }> = [...commentRanges, ...verbatimRanges]

  // Pass 1: mark command names, non-text arguments and math regions.
  let i = 0
  while (i < text.length) {
    if (inAny(i, excluded)) {
      i++
      continue
    }
    if (text[i] === '\\') {
      const name = readName(text, i)
      if (!name) {
        excluded.push({ start: i, end: i + 2 })
        i += 2
        continue
      }
      // The command name itself is not prose.
      excluded.push({ start: i, end: name.end })
      i = name.end

      if (NON_TEXT_COMMAND_ARGS.has(name.name)) {
        // Skip optional [..] and up to two braced arguments.
        let args = 0
        while (i < text.length && args < 2) {
          while (i < text.length && /[\s]/.test(text[i])) i++
          if (text[i] === '[') {
            const end = skipGroup(text, i, '[', ']')
            excluded.push({ start: i, end })
            i = end
            args++
            continue
          }
          if (text[i] === '{') {
            const end = skipGroup(text, i, '{', '}')
            excluded.push({ start: i, end })
            i = end
            args++
            continue
          }
          break
        }
      }
      continue
    }
    if (text[i] === '$') {
      const isDouble = text.startsWith('$$', i)
      const close = isDouble ? text.indexOf('$$', i + 2) : findMathClose(text, i + 1)
      const end = close === -1 ? (isDouble ? i + 2 : i + 1) : close + (isDouble ? 2 : 1)
      excluded.push({ start: i, end })
      i = end
      continue
    }
    i++
  }

  // Pass 2: collect words outside every excluded range.
  const results: ProseRange[] = []
  WORD_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WORD_RE.exec(text)) !== null) {
    const start = match.index
    if (inAny(start, excluded)) continue
    results.push({ word: match[0], start, end: start + match[0].length })
  }
  return results
}

function inAny(pos: number, ranges: Array<{ start: number; end: number }>): boolean {
  for (const range of ranges) {
    if (pos >= range.start && pos < range.end) return true
  }
  return false
}

function skipGroup(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0
  let i = open
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === openCh) depth++
    else if (ch === closeCh) {
      depth--
      if (depth === 0) return i + 1
    }
    i++
  }
  return text.length
}

/** Find the close of inline math starting after an opening `$`. */
function findMathClose(text: string, from: number): number {
  let i = from
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '$') return i
    if (ch === '\n' && text[i + 1] === '\n') return -1 // math does not span blank lines
    i++
  }
  return -1
}

function readName(text: string, pos: number): { name: string; end: number } | null {
  const j = pos + 1
  if (j >= text.length || !/[a-zA-Z]/.test(text[j])) return null
  let end = j
  while (end < text.length && /[a-zA-Z]/.test(text[end])) end++
  if (text[end] === '*') end++
  return { name: text.slice(j, end), end }
}

export { TEXT_COMMANDS }
