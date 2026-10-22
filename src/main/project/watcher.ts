import chokidar, { type FSWatcher } from 'chokidar'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { FsChangeEvent } from '@shared/ipc'

/**
 * Project file watcher (chokidar) with own-write tracking: writes performed
 * by Verso are recorded with the sha256 of the bytes written and their
 * watcher events are suppressed as long as the file on disk still matches
 * that hash. External edits always surface, even right after our own save.
 */

let watcher: FSWatcher | null = null
let watchedRoot: string | null = null

interface OwnWrite {
  /** sha256 of the bytes written, newest last ('' = timestamp-only record). */
  hashes: string[]
  at: number
}
const ownWrites = new Map<string, OwnWrite>()
/** Fallback window for recordings without content (renames, deletes). */
const OWN_WRITE_TTL = 10_000
/** How many recent write hashes to remember (overlapping autosaves/events). */
const MAX_HASHES = 8

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Remember a write the app is about to perform. Pass the exact content that
 * will be on disk afterwards to make detection exact; without content the
 * timestamp fallback is used (renames, deletes).
 */
export function recordOwnWrite(absolutePath: string, content?: string | Uint8Array): void {
  const existing = ownWrites.get(absolutePath)
  const hashes = content === undefined ? [''] : [...(existing?.hashes ?? []), sha256(content)]
  ownWrites.set(absolutePath, {
    hashes: hashes.slice(-MAX_HASHES),
    at: Date.now(),
  })
}

/** True when the file at `absolutePath` was last written by the app itself. */
export async function isOwnWrite(absolutePath: string): Promise<boolean> {
  const entry = ownWrites.get(absolutePath)
  if (!entry) return false
  if (Date.now() - entry.at > OWN_WRITE_TTL) {
    ownWrites.delete(absolutePath)
    return false
  }
  if (entry.hashes.includes('')) return true
  try {
    const bytes = await fs.readFile(absolutePath)
    const diskHash = sha256(bytes)
    // Match against the recent writes: chokidar may emit several events for
    // one save, and an event for save N can arrive while save N+1 is being
    // written (the disk may still hold either content).
    if (entry.hashes.includes(diskHash)) return true
  } catch {
    // File vanished or unreadable — fall through to "not ours".
  }
  ownWrites.delete(absolutePath)
  return false
}

export async function startWatching(
  root: string,
  onEvent: (event: FsChangeEvent) => void
): Promise<void> {
  if (watcher && watchedRoot === root) return
  await stopWatching()

  // Watch the real path (macOS: /var → /private/var) so event paths match the
  // absolute paths used for own-write records (resolveInProject realpaths).
  const realRoot = await fs.realpath(root).catch(() => root)
  watchedRoot = realRoot
  watcher = chokidar.watch(realRoot, {
    ignored: [
      path.join(realRoot, '.openleaf', 'build'),
      path.join(realRoot, '.git'),
      path.join(realRoot, 'node_modules'),
      /(^|[/\\])\../,
    ],
    ignoreInitial: true,
    depth: 12,
  })

  const forward = (type: FsChangeEvent['type']): ((absolutePath: string) => void) => {
    return (absolutePath: string) => {
      void (async () => {
        if (await isOwnWrite(absolutePath)) return
        const rel = path.relative(realRoot, absolutePath).split(path.sep).join('/')
        if (!rel || rel.startsWith('.openleaf')) return
        onEvent({ type, relPath: rel })
      })()
    }
  }

  watcher
    .on('add', forward('add'))
    .on('unlink', forward('unlink'))
    .on('change', forward('change'))
    .on('addDir', forward('addDir'))
    .on('unlinkDir', forward('unlinkDir'))
}

export async function stopWatching(): Promise<void> {
  if (watcher) {
    await watcher.close().catch(() => undefined)
    watcher = null
    watchedRoot = null
  }
  ownWrites.clear()
}
