/**
 * LaTeX structure parser (pure TypeScript, no CodeMirror/Electron imports).
 * Re-implemented from behaviour descriptions; extracts sections, environments,
 * labels/refs/cites, file references and macro definitions, ignoring comments
 * and verbatim regions.
 */

export interface Range {
  start: number
  end: number
}

export interface SectionNode {
  command: string
  /** 0 = part, 1 = chapter, 2 = section, … */
  level: number
  title: string
  /** Offset of the command start. */
  position: number
  line: number
}

export interface EnvironmentNode {
  name: string
  /** Offset of `\begin`. */
  beginPosition: number
  /** Offset of the matching `\end` command, null when unbalanced. */
  endPosition: number | null
  contentStart: number
  contentEnd: number
  beginLine: number
  endLine: number | null
  children: EnvironmentNode[]
}

export type ReferenceKind =
  'label' | 'ref' | 'cite' | 'input' | 'includegraphics' | 'bibliography' | 'bibresource'

export interface ReferenceUse {
  kind: ReferenceKind
  command: string
  key: string
  position: number
  line: number
}

export interface DefinitionEntry {
  kind: 'command' | 'environment' | 'operator'
  name: string
  argCount: number
  position: number
  line: number
}

export interface DocumentStructure {
  sections: SectionNode[]
  environments: EnvironmentNode[]
  references: ReferenceUse[]
  definitions: DefinitionEntry[]
  /** `%region` markers as ranges of the marker comment. */
  regionMarkers: Array<{ kind: 'region' | 'endregion'; line: number; position: number }>
  commentRanges: Range[]
  verbatimRanges: Range[]
}

export const SECTION_COMMANDS: Array<[command: string, level: number]> = [
  ['part', 0],
  ['part*', 0],
  ['chapter', 1],
  ['chapter*', 1],
  ['section', 2],
  ['section*', 2],
  ['subsection', 3],
  ['subsection*', 3],
  ['subsubsection', 4],
  ['subsubsection*', 4],
  ['paragraph', 5],
  ['paragraph*', 5],
  ['subparagraph', 6],
  ['subparagraph*', 6],
]

const ENV_IGNORED = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted'])

const REF_COMMANDS = new Set([
  'ref',
  'eqref',
  'autoref',
  'cref',
  'Cref',
  'pageref',
  'vref',
  'label',
])

const CITE_COMMANDS = new Set([
  'cite',
  'citep',
  'citet',
  'citeauthor',
  'citeyear',
  'Citep',
  'Citet',
  'parencite',
  'Parencite',
  'textcite',
  'Textcite',
  'autocite',
  'Autocite',
  'footcite',
  'footcitetext',
])

const INPUT_COMMANDS = new Set(['input', 'include', 'subfile'])
const BIB_COMMANDS = new Set(['bibliography', 'addbibresource'])

/** Section title text is truncated to this length. */
const MAX_TITLE_LENGTH = 120

interface ScanState {
  commentRanges: Range[]
  verbatimRanges: Range[]
}

/**
 * Scan the document once, marking comment and verbatim regions. A `%` starts
 * a comment unless escaped (`\%`) or inside verbatim. Verbatim-like
 * environments and `\verb<delim>…<delim>` are recorded.
 */
export function scanRegions(text: string): ScanState {
  const commentRanges: Range[] = []
  const verbatimRanges: Range[] = []

  let i = 0
  while (i < text.length) {
    // \verb with arbitrary delimiter.
    if (text.startsWith('\\verb', i) && !isLetterOrStar(text[i + 5] ?? '')) {
      const delim = text[i + 5]
      if (delim && delim !== '*' && !/\s/.test(delim)) {
        const close = text.indexOf(delim, i + 6)
        const end = close === -1 ? text.length : close + 1
        verbatimRanges.push({ start: i, end })
        i = end
        continue
      }
    }
    if (text[i] === '\\') {
      const cmd = readCommandName(text, i)
      if (cmd && cmd.name === 'begin') {
        const arg = readBracedArgument(text, cmd.end)
        if (arg !== null && ENV_IGNORED.has(arg.value)) {
          const endMarker = `\\end{${arg.value}}`
          const close = text.indexOf(endMarker, arg.end)
          const end = close === -1 ? text.length : close + endMarker.length
          verbatimRanges.push({ start: i, end })
          i = end
          continue
        }
      }
      i += cmd ? cmd.name.length + 1 : 1
      continue
    }
    if (text[i] === '%') {
      // Unescaped % starts a comment to end of line.
      let backslashes = 0
      let j = i - 1
      while (j >= 0 && text[j] === '\\') {
        backslashes++
        j--
      }
      if (backslashes % 2 === 0) {
        const lineEnd = text.indexOf('\n', i)
        const end = lineEnd === -1 ? text.length : lineEnd
        commentRanges.push({ start: i, end })
        i = end + 1
        continue
      }
    }
    i++
  }

  return { commentRanges, verbatimRanges }
}

function isLetterOrStar(ch: string): boolean {
  return /[a-zA-Z*]/.test(ch)
}

/** Read a command name at `pos` (which must point at `\`). */
function readCommandName(text: string, pos: number): { name: string; end: number } | null {
  if (text[pos] !== '\\') return null
  const i = pos + 1
  if (i >= text.length) return null
  const ch = text[i]
  if (/[a-zA-Z]/.test(ch)) {
    let end = i
    while (end < text.length && /[a-zA-Z]/.test(text[end])) end++
    const name = text.slice(i, end)
    // Starred variant.
    if (text[end] === '*') {
      return { name: name + '*', end: end + 1 }
    }
    return { name, end }
  }
  // Single-character command like \\, \%, \{.
  return { name: ch, end: i + 1 }
}

/**
 * Read a `{…}` argument starting at `pos` (after optional whitespace),
 * honoring `\{`/`\}` escapes and nested braces. Returns null when the argument
 * is not a brace group or is unbalanced within the document.
 */
function readBracedArgument(
  text: string,
  pos: number
): { value: string; start: number; end: number } | null {
  let i = pos
  while (i < text.length && /\s/.test(text[i])) i++
  if (text[i] !== '{') return null
  const start = i
  let depth = 1
  i++
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return { value: text.slice(start + 1, i), start, end: i + 1 }
      }
    }
    i++
  }
  return null
}

/** Read an optional `[…]` argument after `pos`. */
function readBracketArgument(text: string, pos: number): { value: string; end: number } | null {
  let i = pos
  while (i < text.length && /\s/.test(text[i])) i++
  if (text[i] !== '[') return null
  const start = i
  let depth = 0
  i++
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      if (depth === 0) {
        return { value: text.slice(start + 1, i), end: i + 1 }
      }
      depth--
    }
    i++
  }
  return null
}

function inRanges(pos: number, ranges: Range[]): boolean {
  for (const range of ranges) {
    if (pos >= range.start && pos < range.end) return true
  }
  return false
}

/**
 * Parse a document into its structure. Incremental-friendly: operates on a
 * plain string so callers can re-run on any granularity.
 */
export function parseStructure(text: string): DocumentStructure {
  const { commentRanges, verbatimRanges } = scanRegions(text)
  const ignored = [...commentRanges, ...verbatimRanges]

  // Precompute line starts once; lineOf is then a binary search (O(log n)).
  const lineStarts: number[] = [0]
  for (let idx = 0; idx < text.length; idx++) {
    if (text[idx] === '\n') lineStarts.push(idx + 1)
  }
  const lineOf = (pos: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (lineStarts[mid] <= pos) low = mid
      else high = mid - 1
    }
    return low + 1
  }

  const sections: SectionNode[] = []
  const references: ReferenceUse[] = []
  const definitions: DefinitionEntry[] = []
  const regionMarkers: DocumentStructure['regionMarkers'] = []

  // Collect environment open/close tokens.
  interface EnvToken {
    name: string
    position: number
    end: number
    isEnd: boolean
  }
  const envTokens: EnvToken[] = []

  let i = 0
  while (i < text.length) {
    if (text[i] !== '\\') {
      i++
      continue
    }
    const cmd = readCommandName(text, i)
    if (!cmd) {
      i++
      continue
    }
    if (inRanges(i, ignored)) {
      i = cmd.end
      continue
    }

    const name = cmd.name

    if (name === 'begin' || name === 'end') {
      const arg = readBracedArgument(text, cmd.end)
      if (arg) {
        envTokens.push({ name: arg.value, position: i, end: arg.end, isEnd: name === 'end' })
      }
      i = cmd.end
      continue
    }

    const section = SECTION_COMMANDS.find(([c]) => c === name)
    if (section) {
      const bracket = readBracketArgument(text, cmd.end)
      const braced = readBracedArgument(text, bracket?.end ?? cmd.end)
      if (braced) {
        const title = braced.value.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH)
        sections.push({
          command: name,
          level: section[1],
          title,
          position: i,
          line: lineOf(i),
        })
        i = braced.end
        continue
      }
    }

    if (
      REF_COMMANDS.has(name) ||
      CITE_COMMANDS.has(name) ||
      INPUT_COMMANDS.has(name) ||
      BIB_COMMANDS.has(name) ||
      name === 'includegraphics'
    ) {
      const bracket = readBracketArgument(text, cmd.end)
      const braced = readBracedArgument(text, bracket?.end ?? cmd.end)
      if (braced) {
        const kind: ReferenceKind = REF_COMMANDS.has(name)
          ? name === 'label'
            ? 'label'
            : 'ref'
          : CITE_COMMANDS.has(name)
            ? 'cite'
            : INPUT_COMMANDS.has(name)
              ? 'input'
              : name === 'includegraphics'
                ? 'includegraphics'
                : BIB_COMMANDS.has(name)
                  ? name === 'bibliography'
                    ? 'bibliography'
                    : 'bibresource'
                  : 'ref'
        const keys =
          kind === 'cite' ||
          kind === 'bibliography' ||
          kind === 'bibresource' ||
          name === 'cref' ||
          name === 'Cref'
            ? braced.value
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean)
            : [braced.value.trim()]
        for (const key of keys) {
          if (key) {
            references.push({ kind, command: name, key, position: i, line: lineOf(i) })
          }
        }
        i = braced.end
        continue
      }
    }

    // Definitions.
    if (
      name === 'newcommand' ||
      name === 'renewcommand' ||
      name === 'providecommand' ||
      name === 'DeclareMathOperator'
    ) {
      const bracedName = readBracedArgument(text, cmd.end)
      let nameValue = bracedName?.value
      let after = bracedName?.end ?? cmd.end
      // Also supports the shorthand `\newcommand\foo{…}`.
      if (!nameValue) {
        const afterWs = skipWhitespace(text, cmd.end)
        const shorthand = readCommandName(text, afterWs)
        if (shorthand) {
          nameValue = shorthand.name
          after = shorthand.end
        }
      }
      if (nameValue) {
        let argCount = 0
        const bracket = readBracketArgument(text, after)
        if (bracket && /^\d+$/.test(bracket.value.trim())) {
          argCount = Number(bracket.value.trim())
        }
        definitions.push({
          kind: name === 'DeclareMathOperator' ? 'operator' : 'command',
          name: nameValue.replace(/^[\\/]/, ''),
          argCount,
          position: i,
          line: lineOf(i),
        })
      }
      i = bracedName?.end ?? cmd.end
      continue
    }
    if (name === 'newenvironment' || name === 'renewenvironment') {
      const bracedName = readBracedArgument(text, cmd.end)
      if (bracedName) {
        let argCount = 0
        const bracket = readBracketArgument(text, bracedName.end)
        if (bracket && /^\d+$/.test(bracket.value.trim())) {
          argCount = Number(bracket.value.trim())
        }
        definitions.push({
          kind: 'environment',
          name: bracedName.value.trim(),
          argCount,
          position: i,
          line: lineOf(i),
        })
      }
      i = bracedName?.end ?? cmd.end
      continue
    }

    i = cmd.end
  }

  // %region / %endregion markers (outside verbatim).
  for (const range of commentRanges) {
    const content = text.slice(range.start + 1, range.end).trim()
    if (content === 'region' || content.startsWith('region ') || content === 'endregion') {
      regionMarkers.push({
        kind: content === 'endregion' ? 'endregion' : 'region',
        line: lineOf(range.start),
        position: range.start,
      })
    }
  }

  // Build nested environments.
  const environments = buildEnvironmentTree(envTokens, text, lineOf)

  return {
    sections,
    environments,
    references,
    definitions,
    regionMarkers,
    commentRanges,
    verbatimRanges,
  }
}

function skipWhitespace(text: string, pos: number): number {
  let i = pos
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}

function buildEnvironmentTree(
  tokens: Array<{ name: string; position: number; end: number; isEnd: boolean }>,
  text: string,
  lineOf: (pos: number) => number
): EnvironmentNode[] {
  const root: EnvironmentNode[] = []
  const stack: EnvironmentNode[] = []

  for (const token of tokens) {
    if (!token.isEnd) {
      const node: EnvironmentNode = {
        name: token.name,
        beginPosition: token.position,
        endPosition: null,
        contentStart: token.end,
        contentEnd: token.position,
        beginLine: lineOf(token.position),
        endLine: null,
        children: [],
      }
      const parent = stack[stack.length - 1]
      if (parent) parent.children.push(node)
      else root.push(node)
      stack.push(node)
    } else {
      // Match the nearest open environment with the same name.
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === token.name) {
          const node = stack[s]
          node.endPosition = token.position
          node.contentEnd = token.position
          node.endLine = lineOf(token.position)
          // Pop everything above it too (unbalanced inner environments).
          stack.length = s
          break
        }
      }
    }
  }

  void text
  return root
}

/** Flatten an environment tree in document order. */
export function flattenEnvironments(
  nodes: EnvironmentNode[],
  depth = 0,
  result: Array<{ node: EnvironmentNode; depth: number }> = []
): Array<{ node: EnvironmentNode; depth: number }> {
  for (const node of nodes) {
    result.push({ node, depth })
    flattenEnvironments(node.children, depth + 1, result)
  }
  return result
}

/** Compute the fold range for a section: until the next section of the same or higher level. */
export function sectionFoldRanges(
  sections: SectionNode[],
  textLength: number,
  lineCount: number
): Range[] {
  const ranges: Range[] = []
  for (let idx = 0; idx < sections.length; idx++) {
    const section = sections[idx]
    let end = textLength
    for (let j = idx + 1; j < sections.length; j++) {
      if (sections[j].level <= section.level) {
        end = sections[j].position
        break
      }
    }
    ranges.push({ start: section.position, end })
  }
  void lineCount
  return ranges
}
