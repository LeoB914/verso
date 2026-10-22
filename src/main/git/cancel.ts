/** Cooperative cancellation for long-running git operations. */
let cancelCurrent: (() => void) | null = null

export function cancelGitOperation(): void {
  cancelCurrent?.()
  cancelCurrent = null
}

export function cancellableGit<T>(work: Promise<T>): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    let settled = false
    const finish = (value: T | null, error?: unknown): void => {
      if (settled) return
      settled = true
      cancelCurrent = null
      if (error) reject(error)
      else resolve(value)
    }
    cancelCurrent = () => finish(null)
    work.then(
      (value) => finish(value),
      (error) => finish(null, error)
    )
  })
}
