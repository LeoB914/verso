import { setDiagnostics, type Diagnostic, type LintSource } from '@codemirror/lint'
import type { LogEntry } from '@shared/ipc'
import { matchErrorHelp } from '@shared/latex/error-help'

/**
 * Compile diagnostics as a CodeMirror linter source. Log entries are stashed
 * per file after every compile; the linter serves them for the open file.
 * This must be a linter source (not a one-off setDiagnostics dispatch) because
 * every linter run replaces the whole diagnostics set — a one-off dispatch
 * would be wiped by the spellcheck linter's next run.
 */

const stashedEntries = new Map<string, LogEntry[]>()

/** Store the log entries a file's diagnostics are derived from. */
export function stashDiagnosticsForFile(relPath: string, entries: LogEntry[]): void {
  stashedEntries.set(relPath, entries)
}

/**
 * Show the stashed diagnostics for a view immediately (dispatch), in addition
 * to serving them via the linter source on the next lint run.
 */
export function showStashedDiagnostics(view: unknown, relPath: string): void {
  const v = view as {
    state: { doc: { lines: number; line: (n: number) => { from: number; to: number } } }
    dispatch: (spec: unknown) => void
  }
  const entries = stashedEntries.get(relPath) ?? []
  v.dispatch(
    setDiagnostics(v.state as never, diagnosticsForFile(relPath, entries, v.state.doc as never))
  )
}

/** Forget all diagnostics (called when a new compile starts). */
export function clearDiagnostics(): void {
  stashedEntries.clear()
}

function lineToDiagnostic(
  entry: LogEntry,
  doc: { lines: number; line: (n: number) => { from: number; to: number; text: string } }
): Diagnostic | null {
  if (entry.line === null || entry.file === null) return null
  const lineNo = Math.min(Math.max(1, entry.line), doc.lines)
  const line = doc.line(lineNo)
  const help = entry.level === 'error' ? matchErrorHelp(entry.message) : null
  const message = help
    ? `${entry.message}\n\n${help.explanation}\n\nHow to fix: ${help.fix}`
    : entry.message
  return {
    from: line.from,
    to: Math.max(line.from + 1, line.to),
    severity: entry.level,
    message,
    source: entry.file,
  }
}

/** Build diagnostics for one file from log entries. */
export function diagnosticsForFile(
  relPath: string,
  entries: LogEntry[],
  doc: { lines: number; line: (n: number) => { from: number; to: number } }
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const entry of entries) {
    if (!entry.file) continue
    const entryFile = entry.file.replace(/^\.\//, '')
    if (entryFile !== relPath) continue
    const diagnostic = lineToDiagnostic(entry, doc as never)
    if (diagnostic) diagnostics.push(diagnostic)
  }
  return diagnostics
}

/**
 * Linter source factory serving the stashed compile diagnostics of the view's
 * file. `getRelPath` resolves the project-relative path of a view (kept
 * outside this module to avoid a circular import).
 */
export function createCompileDiagnosticsLinter(
  getRelPath: (view: unknown) => string | null
): LintSource {
  return (view) => {
    const relPath = getRelPath(view)
    if (!relPath) return []
    const entries = stashedEntries.get(relPath) ?? []
    return diagnosticsForFile(relPath, entries, view.state.doc as never)
  }
}
