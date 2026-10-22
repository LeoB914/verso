/**
 * Pure visual-mode layout computation: turns LaTeX source into a list of
 * decoration tasks (replace widgets / marks / line classes). No CodeMirror
 * or DOM imports — the renderer maps tasks to CodeMirror decorations, and
 * unit tests can verify them directly.
 */

import { parseStructure, flattenEnvironments } from './structure'
import type { MathRange } from './bibliography'

export interface VisualContext {
  /** Cursor/selection — constructs overlapping are revealed (raw source). */
  selectionFrom: number
  selectionTo: number
  /** Bib entries for cite chips: key → display label. */
  bibLabels?: Record<string, string>
  /** Math renderer (KaTeX) — injected so this module stays DOM-free. */
  renderMath?: (latex: string, display: boolean) => string | null
  /** Resolve an `\includegraphics` path to an existing project-relative image. */
  resolveImage?: (path: string) => string | null
}

export type VisualTask =
  | {
      type: 'replace'
      from: number
      to: number
      widget:
        | { kind: 'math'; latex: string; display: boolean; html: string | null }
        | { kind: 'chip'; label: string; chipKind: string }
        | { kind: 'label'; text: string }
        | {
            kind: 'figure'
            src: string | null
            caption: string
            label: string | null
            width: string | null
          }
        | {
            kind: 'table'
            rows: string[][]
            caption: string
            label: string | null
          }
        | { kind: 'footnote'; text: string; number: number }
      block?: boolean
    }
  | { type: 'mark'; from: number; to: number; className: string }
  | { type: 'line'; from: number; className: string }

const FORMATTING_COMMANDS: Array<[command: string, className: string]> = [
  ['textbf', 'openleaf-bold'],
  ['textit', 'openleaf-italic'],
  ['emph', 'openleaf-italic'],
  ['underline', 'openleaf-underline'],
  ['texttt', 'openleaf-mono'],
  ['textsc', 'openleaf-smallcaps'],
]

/** Collect inline + display math ranges across the document. */
export function collectMathRanges(text: string): MathRange[] {
  const ranges: MathRange[] = []
  const envRe = /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}/g
  let match: RegExpExecArray | null
  while ((match = envRe.exec(text)) !== null) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      display: true,
      latex: match[2],
    })
  }
  const displayRe = /\\\[([\s\S]*?)\\\]/g
  while ((match = displayRe.exec(text)) !== null) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      display: true,
      latex: match[1],
    })
  }
  let mathStart = -1
  let i = 0
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text.startsWith('$$', i)) {
      const close = text.indexOf('$$', i + 2)
      if (close === -1) break
      ranges.push({ start: i, end: close + 2, display: true, latex: text.slice(i + 2, close) })
      i = close + 2
      continue
    }
    if (text[i] === '$') {
      if (mathStart === -1) mathStart = i
      else {
        ranges.push({
          start: mathStart,
          end: i + 1,
          display: false,
          latex: text.slice(mathStart + 1, i),
        })
        mathStart = -1
      }
    }
    i++
  }
  return ranges
}

function findMatchingBrace(text: string, openBrace: number): number | null {
  let depth = 0
  let i = openBrace
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return null
}

function parseTableRows(content: string): string[][] {
  return content
    .replace(/\\(hline|toprule|midrule|bottomrule|endhead|endfoot)\b/g, '')
    .split(/\\\\/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .map((row) =>
      row
        .replace(/^\[[^\]]*\]/, '')
        .split('&')
        .map((cell) => cell.trim())
    )
}

function captionOf(content: string): string {
  const match = /\\caption(?:\[[^\]]*\])?\{([^{}]*)\}/.exec(content)
  return match?.[1]?.trim() ?? ''
}

function labelOf(content: string): string | null {
  const match = /\\label\{([^{}]+)\}/.exec(content)
  return match?.[1] ?? null
}

function imageWidth(options: string | undefined): string | null {
  if (!options) return null
  const relative = /width\s*=\s*([\d.]+)\s*\\(?:line|text|column)width/.exec(options)
  if (relative) return `${Math.round(Number(relative[1]) * 100)}%`
  return null
}

/** Build the decoration tasks for visual mode. */
export function buildVisualTasks(text: string, context: VisualContext): VisualTask[] {
  const tasks: VisualTask[] = []
  const structure = parseStructure(text)
  const hasCursor = (from: number, to: number): boolean =>
    context.selectionTo >= from && context.selectionFrom <= to
  const environmentNodes = flattenEnvironments(structure.environments).map(({ node }) => node)
  const blocked: Array<[number, number]> = []
  const inBlocked = (from: number, to: number): boolean =>
    blocked.some(([start, end]) => from < end && to > start)

  // Preamble: collapse everything before \begin{document}.
  const docBegin = text.indexOf('\\begin{document}')
  if (docBegin !== -1 && docBegin > 0) {
    const preambleEnd = text.indexOf('\n', docBegin)
    if (!hasCursor(0, docBegin)) {
      tasks.push({
        type: 'replace',
        from: 0,
        to: preambleEnd === -1 ? docBegin : preambleEnd,
        widget: { kind: 'label', text: '▼ Preamble' },
        block: true,
      })
    }
  }

  // Sections.
  for (const section of structure.sections) {
    const lineEnd = text.indexOf('\n', section.position)
    const to = lineEnd === -1 ? text.length : lineEnd
    const lineStart = text.lastIndexOf('\n', section.position) + 1
    tasks.push({
      type: 'line',
      from: lineStart,
      className: `openleaf-heading openleaf-heading-${section.level}`,
    })
    if (!hasCursor(section.position, to)) {
      tasks.push({
        type: 'replace',
        from: section.position,
        to,
        widget: {
          kind: 'chip',
          label: section.title || '(untitled)',
          chipKind: `heading-${section.level}`,
        },
      })
    }
  }

  // Comments dimmed.
  for (const comment of structure.commentRanges) {
    tasks.push({
      type: 'mark',
      from: comment.start,
      to: comment.end,
      className: 'openleaf-comment',
    })
  }

  // Figures and tables: replace the whole float with a rendered widget.
  for (const node of environmentNodes) {
    if (!['figure', 'figure*', 'table', 'table*'].includes(node.name)) continue
    const end = node.endPosition ?? node.contentEnd
    if (hasCursor(node.beginPosition, end)) continue
    const endLineEnd = node.endPosition === null ? end : text.indexOf('\n', node.endPosition) || end
    const to = endLineEnd === -1 ? end : Math.max(end, endLineEnd)
    const content = text.slice(node.contentStart, node.contentEnd)
    const caption = captionOf(content)
    const label = labelOf(content)
    if (node.name.startsWith('figure')) {
      const include = /\\includegraphics(?:\[([^\]]*)\])?\{([^}]+)\}/.exec(content)
      if (!include) continue
      const path = include[2].trim()
      const src = context.resolveImage?.(path) ?? path
      tasks.push({
        type: 'replace',
        from: node.beginPosition,
        to,
        block: true,
        widget: {
          kind: 'figure',
          src,
          caption,
          label,
          width: imageWidth(include[1]),
        },
      })
    } else {
      const tabular = /\\begin\{tabular[x]?\}\{[^}]*\}([\s\S]*?)\\end\{tabular[x]?\}/.exec(content)
      if (!tabular) continue
      tasks.push({
        type: 'replace',
        from: node.beginPosition,
        to,
        block: true,
        widget: { kind: 'table', rows: parseTableRows(tabular[1]), caption, label },
      })
    }
    blocked.push([node.beginPosition, to])
  }

  // Citations and references as chips.
  for (const reference of structure.references) {
    if (inBlocked(reference.position, reference.position + 1)) continue
    const lineEnd = text.indexOf('\n', reference.position)
    const lineText = text.slice(reference.position, lineEnd === -1 ? text.length : lineEnd)
    const match = /^\\[a-zA-Z]+\{([^}]*)\}/.exec(lineText)
    if (!match) continue
    const from = reference.position
    const to = reference.position + match[0].length
    if (hasCursor(from, to)) continue
    if (reference.kind === 'cite') {
      tasks.push({
        type: 'replace',
        from,
        to,
        widget: {
          kind: 'chip',
          label: context.bibLabels?.[reference.key] ?? reference.key,
          chipKind: 'cite',
        },
      })
    } else if (reference.kind === 'label') {
      tasks.push({
        type: 'replace',
        from,
        to,
        widget: { kind: 'chip', label: `#${reference.key}`, chipKind: 'label' },
      })
    } else if (reference.kind === 'ref') {
      tasks.push({
        type: 'replace',
        from,
        to,
        widget: { kind: 'chip', label: `→ ${reference.key}`, chipKind: 'ref' },
      })
    }
  }

  // Math.
  for (const range of collectMathRanges(text)) {
    if (hasCursor(range.start, range.end) || inBlocked(range.start, range.end)) continue
    tasks.push({
      type: 'replace',
      from: range.start,
      to: range.end,
      widget: {
        kind: 'math',
        latex: range.latex,
        display: range.display,
        html: context.renderMath?.(range.latex, range.display) ?? null,
      },
    })
  }

  // Footnotes: superscript marker with the rendered text in a popover.
  let footnoteNumber = 0
  const footnoteRe = /\\footnote\{/g
  let footnoteMatch: RegExpExecArray | null
  while ((footnoteMatch = footnoteRe.exec(text)) !== null) {
    const argStart = footnoteMatch.index + footnoteMatch[0].length
    const argEnd = findMatchingBrace(text, argStart - 1)
    if (argEnd === null) continue
    if (hasCursor(footnoteMatch.index, argEnd + 1) || inBlocked(footnoteMatch.index, argEnd + 1)) {
      continue
    }
    const footnoteText = text.slice(argStart, argEnd)
    footnoteNumber++
    tasks.push({
      type: 'replace',
      from: footnoteMatch.index,
      to: argEnd + 1,
      widget: { kind: 'footnote', text: footnoteText, number: footnoteNumber },
    })
    blocked.push([footnoteMatch.index, argEnd + 1])
  }

  // Environments.
  for (const node of environmentNodes) {
    if (hasCursor(node.beginPosition, node.endPosition ?? node.contentEnd)) continue
    if (inBlocked(node.beginPosition, node.endPosition ?? node.contentEnd)) continue
    const beginLineEnd = text.indexOf('\n', node.beginPosition)
    tasks.push({
      type: 'replace',
      from: node.beginPosition,
      to: beginLineEnd === -1 ? text.length : beginLineEnd,
      widget: { kind: 'label', text: `⟨${node.name}⟩` },
    })
    if (node.endPosition !== null) {
      const endLineEnd = text.indexOf('\n', node.endPosition)
      tasks.push({
        type: 'replace',
        from: node.endPosition,
        to: endLineEnd === -1 ? text.length : endLineEnd,
        widget: { kind: 'label', text: `⟨/${node.name}⟩` },
      })
    }
    if (node.name === 'itemize' || node.name === 'enumerate') {
      const content = text.slice(node.contentStart, node.contentEnd)
      const offset = node.contentStart
      for (const match of content.matchAll(/\\item(\[[^\]]*\])?/g)) {
        const itemFrom = offset + (match.index ?? 0)
        tasks.push({
          type: 'replace',
          from: itemFrom,
          to: itemFrom + match[0].length,
          widget: { kind: 'chip', label: node.name === 'itemize' ? '•' : '1.', chipKind: 'item' },
        })
      }
    }
  }

  // Text formatting commands.
  const commandNames = FORMATTING_COMMANDS.map(([command]) => command).join('|')
  const classByName = new Map(FORMATTING_COMMANDS)
  const BS = String.fromCharCode(92) // the backslash character
  const combined = new RegExp(BS + BS + `(${commandNames})` + BS + '{', 'g')
  let formatMatch: RegExpExecArray | null
  while ((formatMatch = combined.exec(text)) !== null) {
    const className = classByName.get(formatMatch[1])!
    const argStart = formatMatch.index + formatMatch[0].length
    const argEnd = findMatchingBrace(text, argStart - 1)
    if (argEnd === null) continue
    if (inBlocked(formatMatch.index, argEnd + 1)) continue
    if (!hasCursor(formatMatch.index, argEnd + 1)) {
      tasks.push({
        type: 'replace',
        from: formatMatch.index,
        to: argStart,
        widget: { kind: 'chip', label: '', chipKind: 'hidden' },
      })
      tasks.push({
        type: 'replace',
        from: argEnd,
        to: argEnd + 1,
        widget: { kind: 'chip', label: '', chipKind: 'hidden' },
      })
    }
    tasks.push({ type: 'mark', from: argStart, to: argEnd, className })
  }

  return tasks
}
