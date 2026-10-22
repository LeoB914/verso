/**
 * Pure path-safety helpers. Usable from both processes, no Node APIs required,
 * so it can be unit-tested directly (including Windows-style separators).
 */

/** Normalize `\` to `/` and collapse duplicate separators (pure, no fs). */
export function normalizeSeparators(p: string): string {
  return p.replace(/\\+/g, '/')
}

/**
 * True when `p` is a safe relative path:
 * - not empty
 * - not absolute (POSIX `/…`, drive letters `C:/…`, UNC `\\…`)
 * - no `..` segments
 * - no NUL bytes
 * - no trailing/leading whitespace-only segments that could confuse resolution
 */
export function isSafeRelativePath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0) return false
  if (p.includes('\0')) return false
  const normalized = normalizeSeparators(p)
  // Absolute checks.
  if (normalized.startsWith('/')) return false
  if (/^[a-zA-Z]:/.test(normalized)) return false
  if (p.startsWith('\\\\')) return false
  // Relative components.
  const segments = normalized.split('/')
  if (segments.some((s) => s === '..')) return false
  // Reject paths that are only dots or empty segments like './' or 'a/'.
  if (segments.every((s) => s === '' || s === '.')) return false
  return true
}

/**
 * Normalize a safe relative path to its canonical form:
 * `./a//b/` → `a/b`, `.\sub\file.tex` → `sub/file.tex`.
 * Returns null when the path is not safe.
 */
export function canonicalizeRelativePath(p: string): string | null {
  if (!isSafeRelativePath(p)) return null
  const normalized = normalizeSeparators(p)
  const segments = normalized.split('/').filter((s) => s !== '' && s !== '.')
  return segments.join('/')
}
