/**
 * Line-based diff utilities (pure, no dependencies): used for diff stats in
 * the history and git panels. Full rendering is delegated to @codemirror/merge.
 */

export interface DiffStats {
  added: number
  removed: number
}

export function diffStats(oldText: string, newText: string): DiffStats {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  // LCS via dynamic programming on lines (files here are source files; keep
  // it simple and cap input size).
  const MAX_LINES = 5000
  if (oldLines.length > MAX_LINES || newLines.length > MAX_LINES) {
    return { added: newLines.length, removed: oldLines.length }
  }

  const m = oldLines.length
  const n = newLines.length
  // LCS table (flattened to keep memory reasonable).
  const width = n + 1
  const lcs = new Uint32Array((m + 1) * width)
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i * width + j] =
        oldLines[i] === newLines[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }
  const common = lcs[0]
  const removed = m - common
  const added = n - common
  return { added, removed }
}

export function formatDiffStats(stats: DiffStats): string {
  return `+${stats.added} −${stats.removed}`
}
