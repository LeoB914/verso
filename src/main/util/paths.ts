import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { canonicalizeRelativePath } from '@shared/paths'

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathSafetyError'
  }
}

/**
 * Resolve a relative path against the project root, enforcing path safety:
 * - rejects absolute paths, traversal (`..`) and NUL bytes (pure checks)
 * - rejects paths whose realpath (resolving symlinks) escapes the project root
 *
 * Returns the absolute resolved path.
 */
export async function resolveInProject(root: string, relPath: string): Promise<string> {
  const canonical = canonicalizeRelativePath(relPath)
  if (canonical === null) {
    throw new PathSafetyError(`Unsafe path rejected: ${JSON.stringify(relPath)}`)
  }

  let realRoot: string
  try {
    realRoot = await fs.realpath(root)
  } catch {
    throw new PathSafetyError(`Project root does not exist: ${root}`)
  }

  const absolute = path.resolve(realRoot, canonical)

  // A symlink as the final component must resolve inside the root — dangling
  // links are rejected outright (a write would follow them out of the project).
  const finalStat = await fs.lstat(absolute).catch(() => null)
  if (finalStat?.isSymbolicLink()) {
    let resolved: string
    try {
      resolved = await fs.realpath(absolute)
    } catch {
      throw new PathSafetyError(`Refusing to follow a dangling symlink: ${JSON.stringify(relPath)}`)
    }
    if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
      throw new PathSafetyError(`Path escapes the project: ${JSON.stringify(relPath)}`)
    }
    return absolute
  }

  // If the target exists, resolve symlinks and confirm it stays inside the root.
  // If it does not exist (e.g. about to be created), check the nearest existing
  // ancestor instead.
  let checkPath = absolute
  let targetExists = false
  for (let i = 0; i < 64; i++) {
    try {
      await fs.realpath(checkPath)
      targetExists = true
      break
    } catch {
      const parent = path.dirname(checkPath)
      if (parent === checkPath) break
      checkPath = parent
    }
  }

  if (targetExists) {
    const realTarget = await fs.realpath(checkPath)
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      throw new PathSafetyError(`Path escapes the project: ${JSON.stringify(relPath)}`)
    }
  } else {
    throw new PathSafetyError(`Path does not exist and no parent found: ${JSON.stringify(relPath)}`)
  }

  return absolute
}
