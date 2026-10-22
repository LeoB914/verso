/**
 * Parser for `texcount` output (pure). Runs like:
 *   texcount -inc -utf8 -total main.tex
 * or the verbose default form with "Words in text: N" sections per file.
 */

export interface TexcountResult {
  /** Words in text (the number shown in the status bar). */
  words: number
  headers: number
  captions: number
  /** Per-file breakdown when using -inc (multi-file projects). */
  files: Array<{ file: string; words: number; headers: number; captions: number }>
}

/** Parse the `-brief` output: `NNNN+NNN+NN:file` lines (words+headings+captions). */
export function parseTexcountBrief(output: string): TexcountResult | null {
  let words = 0
  let headers = 0
  let captions = 0
  const files: TexcountResult['files'] = []
  let matched = false

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = /^(\d+)\+(\d+)\+(\d+):(.*)$/.exec(line)
    if (!match) continue
    matched = true
    const [w, h, c] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const file = match[4].trim().replace(/^\.\//, '') || '(main)'
    words += w
    headers += h
    captions += c
    files.push({ file, words: w, headers: h, captions: c })
  }

  return matched ? { words, headers, captions, files } : null
}

/** Parse the verbose default output. */
export function parseTexcountVerbose(output: string): TexcountResult | null {
  const files: TexcountResult['files'] = []
  let totalWords = 0
  let totalHeaders = 0
  let totalCaptions = 0
  let matched = false

  const fileBlocks = output.split(/_{5,}/)
  for (const block of fileBlocks) {
    const fileMatch = /^>?([\w./\\ :-]+?):?\s*$/m.exec(block.split('\n')[0] ?? '')
    const words = readLabeledNumber(block, 'Words in text')
    const headers = readLabeledNumber(block, 'Words in headers')
    const captions = readLabeledNumber(block, 'Words outside text \\(captions')
    if (words === null) continue
    matched = true
    const headersValue = headers ?? 0
    const captionsValue = captions ?? 0
    const fileName = fileMatch?.[1]?.trim().replace(/^\.\//, '') ?? '(main)'
    totalWords += words
    totalHeaders += headersValue
    totalCaptions += captionsValue
    files.push({ file: fileName, words, headers: headersValue, captions: captionsValue })
  }

  return matched
    ? { words: totalWords, headers: totalHeaders, captions: totalCaptions, files }
    : null
}

function readLabeledNumber(block: string, label: string): number | null {
  const match = new RegExp(`${label}[^\\d]*(\\d+)`).exec(block)
  return match ? Number(match[1]) : null
}
