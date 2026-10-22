import { realpathSync } from 'node:fs'
import * as path from 'node:path'

/** Canonical path used to compare project registry entries. */
export function canonicalProjectPath(root: string): string {
  const resolved = path.resolve(root)
  try {
    return realpathSync.native(resolved)
  } catch {
    // Missing/inaccessible folders keep their resolved path so they stay
    // visible in the dashboard (with the "Folder missing" hint).
    return resolved
  }
}

interface RegistryLike {
  path: string
  lastOpened: number
  tags: string[]
}

/**
 * Collapse entries that point at the same folder (symlinks, trailing slashes,
 * `..` segments, case-normalised paths on macOS). Keeps the newest timestamp
 * and the union of tags.
 */
export function dedupeProjectEntries<T extends RegistryLike>(projects: readonly T[]): T[] {
  const byPath = new Map<string, T>()
  for (const project of projects) {
    const key = canonicalProjectPath(project.path)
    const existing = byPath.get(key)
    if (!existing) {
      byPath.set(key, { ...project, path: key })
      continue
    }
    const newest = project.lastOpened > existing.lastOpened ? project : existing
    byPath.set(key, {
      ...newest,
      path: key,
      lastOpened: Math.max(existing.lastOpened, project.lastOpened),
      tags: [...new Set([...existing.tags, ...project.tags])],
    })
  }
  return [...byPath.values()]
}
