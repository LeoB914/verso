import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import * as path from 'node:path'
import { AppError } from '../util/errors'
import { PathSafetyError, resolveInProject } from '../util/paths'
import { recordOwnWrite } from './watcher'
import type { FileContent, FileNode } from '@shared/ipc'

const IGNORED_DIRS = new Set(['.openleaf', '.git', 'node_modules'])
const MAX_ENTRIES = 5000

/** Read-only file tree of the project (ignored dirs skipped, folders first). */
export async function listFileTree(
  root: string,
  showHiddenFiles = false
): Promise<FileNode | null> {
  const realRoot = await fs.realpath(root)

  async function walk(
    dir: string,
    rel: string,
    budget: { count: number }
  ): Promise<FileNode | null> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }
    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (budget.count <= 0) break
      if (IGNORED_DIRS.has(entry.name)) continue
      if (!showHiddenFiles && entry.name.startsWith('.')) continue
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        budget.count--
        const child = await walk(path.join(dir, entry.name), relPath, budget)
        if (child) nodes.push(child)
      } else if (entry.isFile()) {
        budget.count--
        nodes.push({ name: entry.name, relPath, type: 'file' })
      }
    }
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return { name: path.basename(dir) || dir, relPath: rel, type: 'dir', children: nodes }
  }

  const tree = await walk(realRoot, '', { count: MAX_ENTRIES })
  if (tree) tree.name = path.basename(realRoot)
  return tree
}

export async function readFileInProject(root: string, relPath: string): Promise<FileContent> {
  const absolute = await resolveInProject(root, relPath)
  const buffer = await fs.readFile(absolute)
  let content = buffer.toString('utf8')
  const hadBom = content.charCodeAt(0) === 0xfeff
  if (hadBom) content = content.slice(1)
  const crlf = content.includes('\r\n')
  // Normalise to LF so every consumer works with one line-ending convention;
  // writes restore CRLF exactly once from the flag.
  content = content.replace(/\r\n/g, '\n')
  const stat = await fs.stat(absolute)
  return { content, mtime: stat.mtimeMs, crlf, hadBom }
}

/**
 * Write a file atomically (temp file + rename) inside the project.
 * Detects conflicts via expectedMtime.
 */
export async function writeFileInProject(
  root: string,
  relPath: string,
  content: string,
  expectedMtime: number | null,
  opts: { crlf: boolean; bom: boolean }
): Promise<{ mtime: number }> {
  const absolute = await resolveInProject(root, relPath)
  const stat = await fs.stat(absolute).catch(() => null)
  if (stat && expectedMtime !== null && Math.abs(stat.mtimeMs - expectedMtime) > 1) {
    throw new PathSafetyError(
      `File changed on disk (${relPath}). Reload it before saving to avoid losing changes.`
    )
  }

  let data = content.replace(/\r\n/g, '\n')
  if (opts.crlf) data = data.replace(/\n/g, '\r\n')
  if (opts.bom) data = '\uFEFF' + data

  // Record the exact bytes before they hit the disk so the watcher can match
  // them by hash (independent of save duration or TTL).
  recordOwnWrite(absolute, data)

  const tmp = absolute + '.openleaf-tmp-' + Math.random().toString(36).slice(2, 8)
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, absolute)
  const newStat = await fs.stat(absolute)
  return { mtime: newStat.mtimeMs }
}

/**
 * Ensure `.openleaf/build/` is gitignored: create or append to `.gitignore`,
 * never duplicating lines.
 */
export async function ensureBuildIgnored(root: string): Promise<void> {
  const gitignorePath = path.join(root, '.gitignore')
  let content = ''
  try {
    content = await fs.readFile(gitignorePath, 'utf8')
  } catch {
    // No .gitignore yet.
  }
  const lines = new Set(content.split(/\r?\n/).map((l) => l.trim()))
  const needed = ['.openleaf/build/']
  let changed = false
  for (const line of needed) {
    if (!lines.has(line)) {
      if (content.length > 0 && !content.endsWith('\n')) content += '\n'
      content += line + '\n'
      changed = true
    }
  }
  if (changed) {
    await fs.writeFile(gitignorePath, content, 'utf8')
  }
}

// --- File operations (Phase 4) ----------------------------------------------

import { shell } from 'electron'

function splitName(relPath: string): { dir: string; name: string } {
  const segments = relPath.split('/')
  const name = segments.pop() ?? ''
  return { dir: segments.join('/'), name }
}

/**
 * Resolve the directory a target path lives in. "" / "." mean the project
 * root itself (resolveInProject rejects "." by design).
 */
async function resolveTargetDir(root: string, targetDir: string): Promise<string> {
  if (targetDir === '' || targetDir === '.') {
    try {
      return await fs.realpath(root)
    } catch {
      throw new PathSafetyError(`Project root does not exist: ${root}`)
    }
  }
  return resolveInProject(root, targetDir)
}

/** Create a file or folder (parents auto-created). */
export async function createFileOrFolder(
  root: string,
  relPath: string,
  type: 'file' | 'folder',
  content = ''
): Promise<void> {
  const absolute = await resolveInProject(root, relPath)
  recordOwnWrite(absolute)
  if (type === 'folder') {
    await fs.mkdir(absolute, { recursive: true })
  } else {
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, content, { encoding: 'utf8', flag: 'wx' })
  }
}

/** Unique name helper: "figure" -> "figure-2" if taken. */
async function uniqueTarget(root: string, targetRelPath: string): Promise<string> {
  const { dir, name } = splitName(targetRelPath)
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  let candidate = targetRelPath
  let index = 1
  for (;;) {
    // resolveInProject enforces path safety; lstat decides whether the name
    // is actually taken (it throws ENOENT for a free name).
    const absolute = await resolveInProject(root, candidate)
    try {
      await fs.lstat(absolute)
    } catch {
      return candidate
    }
    index++
    candidate = (dir ? dir + '/' : '') + base + '-' + index + ext
  }
}

/** Rename or move a file/folder within the project. Never overwrites. */
export async function renameOrMove(
  root: string,
  relPath: string,
  targetRelPath: string
): Promise<void> {
  const from = await resolveInProject(root, relPath)
  const toDir = await resolveTargetDir(root, path.dirname(targetRelPath))
  const target = path.join(toDir, path.basename(targetRelPath))
  if (target === from) return

  const existing = await fs.lstat(target).catch(() => null)
  if (existing) {
    // Allow a pure case change of the same file (case-insensitive filesystems
    // resolve the target to the very same inode).
    const fromStat = await fs.stat(from).catch(() => null)
    const targetStat = await fs.stat(target).catch(() => null)
    const sameFile =
      fromStat !== null &&
      targetStat !== null &&
      fromStat.dev === targetStat.dev &&
      fromStat.ino === targetStat.ino
    if (!sameFile) {
      throw new AppError('exists', `A file named "${path.basename(targetRelPath)}" already exists.`)
    }
  }

  recordOwnWrite(from)
  recordOwnWrite(target)
  await fs.rename(from, target)
}

/** Duplicate a file or folder with a unique "-2" style name. */
export async function duplicatePath(root: string, relPath: string): Promise<string> {
  await resolveInProject(root, relPath)
  const { dir, name } = splitName(relPath)
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  const target = await uniqueTarget(
    root,
    dir ? dir + '/' + base + ' copy' + ext : base + ' copy' + ext
  )
  const from = await resolveInProject(root, relPath)
  const toDir = await resolveTargetDir(root, path.dirname(target))
  const dest = path.join(toDir, path.basename(target))
  recordOwnWrite(dest)
  await fs.cp(from, dest, { recursive: true })
  return target
}

/** Move a file/folder to the OS trash. */
export async function trashPath(root: string, relPath: string): Promise<void> {
  const absolute = await resolveInProject(root, relPath)
  recordOwnWrite(absolute)
  await shell.trashItem(absolute)
}

/** Import a file dropped from the OS into the project (dedupe names). */
export async function importExternalFile(
  root: string,
  sourceAbsolutePath: string,
  targetDir: string
): Promise<string | null> {
  const name = path.basename(sourceAbsolutePath)
  const stat = await fs.stat(sourceAbsolutePath).catch(() => null)
  if (!stat || !stat.isFile()) return null
  const target = await uniqueTarget(root, targetDir ? targetDir + '/' + name : name)
  const destDir = await resolveTargetDir(root, targetDir)
  const dest = path.join(destDir, path.basename(target))
  await fs.mkdir(path.dirname(dest), { recursive: true })
  recordOwnWrite(dest)
  // COPYFILE_EXCL: never follow or replace something that appeared meanwhile.
  await fs.copyFile(sourceAbsolutePath, dest, constants.COPYFILE_EXCL)
  return target
}

/** Import raw image bytes (clipboard paste) into the project. */
export async function importImageBytes(
  root: string,
  name: string,
  dataBase64: string,
  targetDir = 'figures'
): Promise<string> {
  const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_') || 'pasted-image.png'
  const target = await uniqueTarget(root, targetDir ? `${targetDir}/${safeName}` : safeName)
  const destDir = await resolveTargetDir(root, targetDir)
  const dest = path.join(destDir, path.basename(target))
  await fs.mkdir(path.dirname(dest), { recursive: true })
  recordOwnWrite(dest)
  await fs.writeFile(dest, Buffer.from(dataBase64, 'base64'), { flag: 'wx' })
  return target
}
