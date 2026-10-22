import * as fs from 'node:fs/promises'
import * as crypto from 'node:crypto'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import { promisify } from 'node:util'
import { app } from 'electron'
import { readFileInProject, writeFileInProject } from '../project/files'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

/**
 * Snapshot history store, independent of Git. Content-addressed blobs
 * (sha256 → gzip-compressed content) live in
 * `userData/history/<projectId>/blobs/`, the snapshot index in `index.json`.
 * Only changed files are stored (dedupe by hash).
 */

export interface Snapshot {
  id: string
  timestamp: number
  files: Record<string, string>
  images?: Record<string, string>
  label?: string
  reason: string
}

export interface RetentionPolicy {
  /** Always keep labelled snapshots. */
  keepLabelled: boolean
  /** Keep everything younger than this many days. */
  fullDays: number
  /** After that, keep one snapshot per day for this many days. */
  dailyDays: number
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  keepLabelled: true,
  fullDays: 7,
  dailyDays: 90,
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

const TEXT_EXTENSIONS = new Set([
  'tex',
  'ltx',
  'sty',
  'cls',
  'bib',
  'txt',
  'md',
  'csv',
  'tikz',
  'json',
  'cfg',
  'log',
])

function projectIdOf(root: string): string {
  return crypto.createHash('sha256').update(root).digest('hex').slice(0, 16)
}

export function historyDir(root: string): string {
  return path.join(userDataBaseDir(), 'history', projectIdOf(root))
}

/** Test hook: redirect the history base dir (defaults to Electron userData). */
let baseDirOverride: string | null = null
export function setHistoryBaseDir(dir: string): void {
  baseDirOverride = dir
}

function userDataBaseDir(): string {
  if (baseDirOverride) return baseDirOverride
  return app.getPath('userData')
}

function blobsDir(root: string): string {
  return path.join(historyDir(root), 'blobs')
}

function indexPath(root: string): string {
  return path.join(historyDir(root), 'index.json')
}

async function readIndex(root: string): Promise<Snapshot[]> {
  try {
    return JSON.parse(await fs.readFile(indexPath(root), 'utf8')) as Snapshot[]
  } catch {
    return []
  }
}

async function writeIndex(root: string, snapshots: Snapshot[]): Promise<void> {
  await fs.mkdir(path.dirname(indexPath(root)), { recursive: true })
  // Atomic: a crash mid-write must never leave a truncated index (which would
  // read back as "no history" and be overwritten by the next snapshot).
  const tmp = `${indexPath(root)}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(snapshots, null, 0))
  await fs.rename(tmp, indexPath(root))
}

/**
 * Index mutations (create, prune) run one at a time per project. Without this,
 * a snapshot and a concurrent prune read the same index and the later write
 * drops the other's result — or the prune garbage-collects blobs that the
 * in-flight snapshot just stored.
 */
const indexQueues = new Map<string, Promise<unknown>>()
function withIndexLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const previous = indexQueues.get(root) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(work)
  indexQueues.set(
    root,
    run.catch(() => undefined)
  )
  return run
}

/** Largest text file kept in a snapshot; bigger files are skipped, never truncated. */
const MAX_SNAPSHOT_TEXT_CHARS = 2_000_000

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Store a blob if not present; returns its hash. */
async function storeBlob(root: string, content: string): Promise<string> {
  const hash = hashContent(content)
  const blobPath = path.join(blobsDir(root), hash + '.gz')
  try {
    await fs.access(blobPath)
  } catch {
    await fs.mkdir(path.dirname(blobPath), { recursive: true })
    await fs.writeFile(blobPath, await gzip(content, { level: 6 }))
  }
  return hash
}

async function readBlob(root: string, hash: string): Promise<string | null> {
  try {
    const data = await fs.readFile(path.join(blobsDir(root), hash + '.gz'))
    return (await gunzip(data)).toString('utf8')
  } catch {
    return null
  }
}

/** Read all indexable text files of the project (respecting ignore list). */
async function collectProjectFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const ignoredDirs = new Set(['.openleaf', '.git', 'node_modules'])

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > 10) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (ignoredDirs.has(entry.name)) continue
      if (depth === 0 && entry.name.startsWith('.')) continue
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath, depth + 1)
      } else if (entry.isFile()) {
        const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
        if (!TEXT_EXTENSIONS.has(ext)) continue
        try {
          // A truncated copy would corrupt the file on restore — skip instead.
          const content = await fs.readFile(path.join(dir, entry.name), 'utf8')
          if (content.length <= MAX_SNAPSHOT_TEXT_CHARS) files[relPath] = content
        } catch {
          // Skip unreadable files.
        }
      }
    }
  }

  await walk(root, '', 0)
  return files
}

/** Collect image files as base64 for before/after previews in history. */
async function collectProjectImages(root: string): Promise<Record<string, string>> {
  const images: Record<string, string> = {}
  const ignoredDirs = new Set(['.openleaf', '.git', 'node_modules'])
  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > 10) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (ignoredDirs.has(entry.name)) continue
      if (depth === 0 && entry.name.startsWith('.')) continue
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath, depth + 1)
      } else if (entry.isFile()) {
        const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
        if (!IMAGE_EXTENSIONS.has(ext)) continue
        try {
          const buffer = await fs.readFile(path.join(dir, entry.name))
          if (buffer.length <= 10_000_000) images[relPath] = buffer.toString('base64')
        } catch {
          // skip
        }
      }
    }
  }
  await walk(root, '', 0)
  return images
}

/**
 * Create a snapshot. `previousContent` can carry unsaved editor content that
 * overrides what is on disk (keyed by relPath).
 */
export function createSnapshot(
  root: string,
  reason: string,
  label?: string,
  overrides?: Record<string, string>
): Promise<Snapshot> {
  return withIndexLock(root, () => createSnapshotUnlocked(root, reason, label, overrides))
}

/** Reason used by the periodic timer; skipped when nothing changed. */
export const AUTO_SNAPSHOT_REASON = 'Auto snapshot'

function sameEntries(a: Record<string, string> = {}, b: Record<string, string> = {}): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

async function createSnapshotUnlocked(
  root: string,
  reason: string,
  label?: string,
  overrides?: Record<string, string>
): Promise<Snapshot> {
  const files = await collectProjectFiles(root)
  if (overrides) {
    for (const [relPath, content] of Object.entries(overrides)) {
      files[relPath] = content
    }
  }
  const stored: Record<string, string> = {}
  for (const [relPath, content] of Object.entries(files)) {
    stored[relPath] = await storeBlob(root, content)
  }
  const imageContents = await collectProjectImages(root)
  const storedImages: Record<string, string> = {}
  for (const [relPath, base64] of Object.entries(imageContents)) {
    storedImages[relPath] = await storeBlob(root, base64)
  }

  const snapshots = await readIndex(root)
  // Periodic snapshots only record actual changes (no entries while idle).
  const latest = snapshots[snapshots.length - 1]
  if (
    reason === AUTO_SNAPSHOT_REASON &&
    label === undefined &&
    latest &&
    sameEntries(latest.files, stored) &&
    sameEntries(latest.images, storedImages)
  ) {
    return latest
  }
  const snapshot: Snapshot = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: Date.now(),
    files: stored,
    images: storedImages,
    reason,
    ...(label !== undefined ? { label } : {}),
  }
  snapshots.push(snapshot)
  await writeIndex(root, snapshots)
  return snapshot
}

export async function listSnapshots(root: string): Promise<Snapshot[]> {
  return readIndex(root)
}

/** Read the stored file contents of a snapshot. */
export async function getSnapshotContents(
  root: string,
  snapshotId: string
): Promise<Record<string, string> | null> {
  const snapshots = await readIndex(root)
  const snapshot = snapshots.find((s) => s.id === snapshotId)
  if (!snapshot) return null
  const result: Record<string, string> = {}
  for (const [relPath, hash] of Object.entries(snapshot.files)) {
    const content = await readBlob(root, hash)
    if (content !== null) result[relPath] = content
  }
  return result
}

/** Read an image from a snapshot as a data URL (base64). */
export async function getSnapshotImage(
  root: string,
  snapshotId: string,
  relPath: string
): Promise<string | null> {
  const snapshots = await readIndex(root)
  const snapshot = snapshots.find((entry) => entry.id === snapshotId)
  const hash = snapshot?.images?.[relPath]
  if (!hash) return null
  const base64 = await readBlob(root, hash)
  if (!base64) return null
  const ext = path.extname(relPath).slice(1).toLowerCase()
  const mime = ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext || 'png'
  return `data:image/${mime};base64,${base64}`
}

/** Restore a single file from a snapshot. Returns true when restored. */
export async function restoreFile(
  root: string,
  snapshotId: string,
  relPath: string,
  overrides?: Record<string, string>
): Promise<boolean> {
  const contents = await getSnapshotContents(root, snapshotId)
  if (!contents || !(relPath in contents)) return false
  // Never destroy the current version silently: snapshot it first (including
  // the renderer's dirty buffer when one was passed as an override).
  await createSnapshot(root, 'Before restore', undefined, overrides)
  const existing = await readFileInProject(root, relPath).catch(() => null)
  await writeFileInProject(root, relPath, contents[relPath], null, {
    crlf: existing?.crlf ?? false,
    bom: existing?.hadBom ?? false,
  })
  return true
}

/**
 * Restore the whole project to a snapshot. The current state (plus unsaved
 * editor buffers passed as overrides) is snapshotted first ("Before restore").
 * Returns the files that actually changed, or null for an unknown snapshot.
 */
export async function restoreProject(
  root: string,
  snapshotId: string,
  overrides?: Record<string, string>
): Promise<string[] | null> {
  const contents = await getSnapshotContents(root, snapshotId)
  if (!contents) return null
  await createSnapshot(root, 'Before restore', undefined, overrides)
  const restored: string[] = []
  for (const [relPath, content] of Object.entries(contents)) {
    try {
      const existing = await readFileInProject(root, relPath).catch(() => null)
      if (existing?.content === content.replace(/\r\n/g, '\n')) continue
      await writeFileInProject(root, relPath, content, null, {
        crlf: existing?.crlf ?? false,
        bom: existing?.hadBom ?? false,
      })
      restored.push(relPath)
    } catch {
      // Skip paths that no longer resolve inside the project.
    }
  }
  return restored
}

/** Apply the retention policy (prune old, non-labelled snapshots). */
export function pruneSnapshots(
  root: string,
  policy: RetentionPolicy = DEFAULT_RETENTION
): Promise<number> {
  return withIndexLock(root, () => pruneSnapshotsUnlocked(root, policy))
}

async function pruneSnapshotsUnlocked(root: string, policy: RetentionPolicy): Promise<number> {
  const snapshots = await readIndex(root)
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const keep: Snapshot[] = []
  const lastPerDay = new Map<string, Snapshot>()

  for (const snapshot of snapshots) {
    const ageDays = (now - snapshot.timestamp) / day
    if (policy.keepLabelled && snapshot.label) {
      keep.push(snapshot)
      continue
    }
    if (ageDays <= policy.fullDays) {
      keep.push(snapshot)
      continue
    }
    if (ageDays <= policy.fullDays + policy.dailyDays) {
      const dayKey = new Date(snapshot.timestamp).toISOString().slice(0, 10)
      const previous = lastPerDay.get(dayKey)
      if (!previous || previous.timestamp < snapshot.timestamp) {
        lastPerDay.set(dayKey, snapshot)
      }
      continue
    }
    // Dropped.
  }
  for (const snapshot of lastPerDay.values()) keep.push(snapshot)

  keep.sort((a, b) => a.timestamp - b.timestamp)
  const pruned = snapshots.length - keep.length
  if (pruned > 0) {
    await writeIndex(root, keep)
    // Garbage-collect unreferenced blobs.
    const referenced = new Set<string>()
    for (const snapshot of keep) {
      for (const hash of Object.values(snapshot.files)) referenced.add(hash)
      // Image blobs are referenced too — dropping them broke image diffs.
      for (const hash of Object.values(snapshot.images ?? {})) referenced.add(hash)
    }
    let blobs
    try {
      blobs = await fs.readdir(blobsDir(root))
    } catch {
      return pruned
    }
    for (const blob of blobs) {
      if (!referenced.has(blob.replace(/\.gz$/, ''))) {
        await fs.rm(path.join(blobsDir(root), blob), { force: true })
      }
    }
  }
  return pruned
}
