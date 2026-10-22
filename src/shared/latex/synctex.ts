/**
 * Parser for the text output of the `synctex view` and `synctex edit` CLI
 * commands (pure, unit-tested with fixtures).
 *
 * `synctex view -i line:col:file -o out.pdf` prints blocks like:
 *   SyncTeX result begin
 *   Output:out.pdf
 *   Input:./sections/intro.tex
 *   Line:012
 *   Column:0
 *   Page:3
 *   x:148.712997
 *   y:668.111221
 *   h:148.712997
 *   v:669.517639
 *   W:310.123457
 *   H:10.909091
 *   before:
 *   offset:0
 *   middle:
 *   after:
 *   SyncTeX result end
 *
 * `synctex edit -o page:x:y:out.pdf` prints:
 *   SyncTeX result begin
 *   Input:./main.tex
 *   Line:00042
 *   Column:000
 *   Offset:0
 *   Context:
 *   SyncTeX result end
 */

export interface SynctexViewResult {
  /** Source file — null when the synctex CLI omits it (synctex 1.5 view mode). */
  file: string | null
  line: number | null
  column: number
  page: number
  /** Position in PDF points (72 dpi), y measured from the top. */
  x: number
  y: number
  width: number
  height: number
}

export interface SynctexEditResult {
  file: string
  line: number
  column: number
}

export function parseSynctexView(output: string): SynctexViewResult | null {
  const blocks = splitBlocks(output)
  for (const block of blocks) {
    const file = readField(block, 'Input')
    const line = readNumber(block, 'Line')
    const page = readNumber(block, 'Page')
    const x = readNumber(block, 'x')
    const y = readNumber(block, 'y')
    const h = readNumber(block, 'h')
    const v = readNumber(block, 'v')
    const width = readNumber(block, 'W') ?? 0
    const height = readNumber(block, 'H') ?? 0
    // synctex 1.5 (TeX Live 2026) omits Input/Line in view mode — the source
    // file is known anyway, so page and geometry are enough.
    if (page !== null && x !== null && h !== null && (y !== null || v !== null)) {
      return {
        file: file ? file.replace(/^\.\//, '') : null,
        line,
        column: 0,
        page,
        x,
        y: y ?? v ?? 0,
        width,
        height,
      }
    }
  }
  return null
}

export function parseSynctexEdit(output: string): SynctexEditResult | null {
  const blocks = splitBlocks(output)
  for (const block of blocks) {
    const file = readField(block, 'Input')
    const line = readNumber(block, 'Line')
    if (file !== null && line !== null) {
      return { file: file.replace(/^\.\//, ''), line, column: readNumber(block, 'Column') ?? 0 }
    }
  }
  return null
}

function splitBlocks(output: string): string[] {
  const blocks: string[] = []
  const begin = output.indexOf('SyncTeX result begin')
  while (begin !== -1) {
    const end = output.indexOf('SyncTeX result end', begin)
    blocks.push(end === -1 ? output.slice(begin) : output.slice(begin, end))
    if (end === -1) break
    const next = output.indexOf('SyncTeX result begin', end)
    if (next === -1) break
  }
  if (blocks.length === 0 && output.includes('Input:')) {
    // Tolerate outputs without the begin/end markers.
    blocks.push(output)
  }
  return blocks
}

function readField(block: string, field: string): string | null {
  const match = new RegExp(`^${field}:(.*)$`, 'm').exec(block)
  return match ? match[1].trim() : null
}

function readNumber(block: string, field: string): number | null {
  const value = readField(block, field)
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
