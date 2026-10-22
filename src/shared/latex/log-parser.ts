import type { LogEntry, LogLevel } from '@shared/ipc'

/**
 * LaTeX log parser (pure string processing, unit-tested against real log
 * fixtures in `tests/fixtures/logs/`). Re-implemented from behaviour
 * descriptions.
 *
 * Understands the `-file-line-error` output format of pdfLaTeX/XeLaTeX/
 * LuaLaTeX as orchestrated by latexmk.
 */

const FILE_LINE_ERROR_RE = /^(.+?\.(?:tex|ltx|sty|cls|bib)):(\d+): (.*)$/
const BANG_ERROR_RE = /^! (.*)$/
const LINE_REF_RE = /^\s*l\.(\d+)/
const OPEN_FILE_RE = /\(\.\/([^\s()]+\.tex)/

/** Strip the `./` prefix logs use for files in the working directory. */
function cleanFilePath(file: string | null): string | null {
  if (!file) return null
  return file.replace(/^\.\//, '')
}
const UNDEFINED_REF_RE =
  /LaTeX Warning: (?:Reference|Label)`?([^']+)'? on page \d+ undefined on input line (\d+)\./
const UNDEFINED_CITATION_RE =
  /LaTeX Warning: (?:Citation)`?([^']+)'? on page \d+ undefined on input line (\d+)\./
const BOX_RE = /^(Overfull|Underfull) \\[hv]box \((.*)\)/
const PACKAGE_WARNING_RE = /^Package (\S+) Warning: (.*)/
const CLASS_WARNING_RE = /^Class (\S+) Warning: (.*)/
const BIBER_ERROR_RE =
  /Biber error: (.*)|^I found no \\[a-zA-Z]+ command|There were \d+ error messages/
const EMERGENCY_RE = /^! ==> (Fatal error occurred|Emergency stop)/

/** Track the currently-open source file via `(./path` markers in the log. */
function currentFileOf(state: { file: string | null }): string | null {
  return cleanFilePath(state.file)
}

function pushEntry(
  entries: LogEntry[],
  seen: Set<string>,
  level: LogLevel,
  file: string | null,
  line: number | null,
  message: string,
  rawExcerpt?: string
): void {
  const key = `${level}|${file ?? ''}|${line ?? ''}|${message}`
  if (seen.has(key)) return
  seen.add(key)
  entries.push({ level, file, line, message, rawExcerpt })
}

export function parseLog(log: string): LogEntry[] {
  const entries: LogEntry[] = []
  const seen = new Set<string>()
  const state = { file: null as string | null }

  const lines = log.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Track `(./main.tex` open-file markers (best effort).
    const open = OPEN_FILE_RE.exec(line)
    if (open) state.file = open[1]

    // 1. -file-line-error style: `./main.tex:12: Undefined control sequence.`
    const fle = FILE_LINE_ERROR_RE.exec(line)
    if (fle) {
      const excerpt = collectExcerpt(lines, i, 4)
      const file = fle[1].replace(/^\.\//, '')
      pushEntry(entries, seen, 'error', file, Number(fle[2]), fle[3].trim(), excerpt)
      continue
    }

    // 1b. Same, but the `path:12:` prefix was split across two lines by TeX's
    // 79-character log wrapping (long project paths). Re-join and retry.
    if (i + 1 < lines.length) {
      const joined = FILE_LINE_ERROR_RE.exec(line + lines[i + 1])
      const nextAlone = FILE_LINE_ERROR_RE.test(lines[i + 1])
      if (joined && !nextAlone) {
        const excerpt = collectExcerpt(lines, i + 1, 4)
        const file = joined[1].replace(/^\.\//, '')
        pushEntry(entries, seen, 'error', file, Number(joined[2]), joined[3].trim(), excerpt)
        i++
        continue
      }
    }

    // 2. `! LaTeX Error:` / `! Undefined control sequence.` / `! Missing $ inserted.`
    const bang = BANG_ERROR_RE.exec(line)
    if (bang) {
      let message = bang[1].trim()
      // Continuation lines until an empty line or `l.<n>`.
      let j = i + 1
      while (
        j < lines.length &&
        !LINE_REF_RE.test(lines[j]) &&
        lines[j].trim() !== '' &&
        !lines[j].startsWith('!')
      ) {
        if (!message.startsWith('LaTeX Error:') && lines[j].startsWith('LaTeX Error:')) {
          message = lines[j].trim()
        }
        j++
      }
      // Line reference like `l.42 \brokencommand` (may follow blank lines).
      let lineNo: number | null = null
      for (let k = j; k < Math.min(lines.length, j + 5); k++) {
        const lref = LINE_REF_RE.exec(lines[k])
        if (lref) {
          lineNo = Number(lref[1])
          break
        }
      }
      const excerpt = collectExcerpt(lines, i, 6)
      pushEntry(entries, seen, 'error', currentFileOf(state), lineNo, message, excerpt)
      continue
    }

    // 3. Emergency stop / fatal error.
    const emergency = EMERGENCY_RE.exec(line)
    if (emergency) {
      pushEntry(
        entries,
        seen,
        'error',
        currentFileOf(state),
        null,
        line.replace(/^! ==> /, ''),
        undefined
      )
      continue
    }

    // 4. Undefined references / citations.
    const ref = UNDEFINED_REF_RE.exec(line)
    if (ref) {
      pushEntry(
        entries,
        seen,
        'warning',
        currentFileOf(state),
        Number(ref[2]),
        `Reference '${ref[1]}' is undefined`,
        line.trim()
      )
      continue
    }
    const cit = UNDEFINED_CITATION_RE.exec(line)
    if (cit) {
      pushEntry(
        entries,
        seen,
        'warning',
        currentFileOf(state),
        Number(cit[2]),
        `Citation '${cit[1]}' is undefined`,
        line.trim()
      )
      continue
    }

    // 5. Overfull/underfull boxes → info.
    const box = BOX_RE.exec(line)
    if (box) {
      pushEntry(
        entries,
        seen,
        'info',
        currentFileOf(state),
        null,
        `${box[1]} \\box (${box[2]})`,
        line.trim()
      )
      continue
    }

    // 6. Package/class warnings.
    const pkg = PACKAGE_WARNING_RE.exec(line)
    if (pkg) {
      pushEntry(
        entries,
        seen,
        'warning',
        currentFileOf(state),
        null,
        `Package ${pkg[1]}: ${pkg[2].trim()}`,
        line.trim()
      )
      continue
    }
    const cls = CLASS_WARNING_RE.exec(line)
    if (cls) {
      pushEntry(
        entries,
        seen,
        'warning',
        currentFileOf(state),
        null,
        `Class ${cls[1]}: ${cls[2].trim()}`,
        line.trim()
      )
      continue
    }

    // 7. Biber errors (as relayed by latexmk into the log or console capture).
    const biber = BIBER_ERROR_RE.exec(line)
    if (biber) {
      pushEntry(
        entries,
        seen,
        'error',
        currentFileOf(state),
        null,
        `Biber: ${line.trim()}`,
        line.trim()
      )
      continue
    }
  }

  return entries
}

function collectExcerpt(lines: string[], start: number, count: number): string {
  return lines
    .slice(start, start + count)
    .join('\n')
    .slice(0, 500)
}

export function countErrors(entries: LogEntry[]): number {
  return entries.filter((e) => e.level === 'error').length
}
