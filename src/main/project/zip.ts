import { dialog, BrowserWindow } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import JSZip from 'jszip'
import type { ProjectInfo } from '@shared/ipc'
import { resolveInProject } from '../util/paths'
import { defaultProjectDirectory } from './registry'
import { openProject, readProjectConfig } from './config'

/**
 * ZIP import/export. Import is zip-slip safe: every entry path is validated
 * against the extraction root and the total uncompressed size is limited.
 */

const MAX_TOTAL_UNCOMPRESSED = 500 * 1024 * 1024 // 500 MB
const JUNK_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

async function extractZipSafe(zipPath: string, destRoot: string): Promise<void> {
  const data = await fs.readFile(zipPath)
  const zip = await JSZip.loadAsync(data)

  let totalSize = 0
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  for (const entry of entries) {
    const size =
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    totalSize += size
    if (totalSize > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error('ZIP archive is too large to import (limit: 500 MB).')
    }
  }

  // Strip a single top-level folder if all entries share it.
  const relPaths = entries.map((entry) => entry.name.split('/')[0])
  const stripTopLevel =
    relPaths.length > 0 &&
    relPaths.every((top) => top === relPaths[0] && !top.endsWith('..')) &&
    entries.some((e) => e.name.includes('/'))

  for (const entry of entries) {
    let relPath = stripTopLevel ? entry.name.split('/').slice(1).join('/') : entry.name
    if (relPath === '') continue
    if (JUNK_FILES.has(path.basename(relPath))) continue

    // Zip-slip protection: canonicalize and reject traversal.
    const segments = relPath.split('/')
    if (
      segments.some((segment) => segment === '..' || segment === '') &&
      segments.filter(Boolean).length === 0
    )
      continue
    if (segments.some((segment) => segment === '..')) {
      throw new Error(`Unsafe entry in ZIP rejected: ${entry.name}`)
    }
    relPath = segments.filter(Boolean).join('/')
    if (relPath === '') continue

    const target = path.join(destRoot, relPath)
    if (!target.startsWith(destRoot + path.sep) && target !== destRoot) {
      throw new Error(`Unsafe entry in ZIP rejected: ${entry.name}`)
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    const content = await entry.async('nodebuffer')
    await fs.writeFile(target, content)
  }
}

/** Ask for a ZIP file and import it as a new project. */
export async function importZipProject(): Promise<ProjectInfo | null> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Import Project from ZIP',
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return null
  return importZipFromPath(filePaths[0])
}

export async function importZipFromPath(zipPath: string): Promise<ProjectInfo | null> {
  const base = path.basename(zipPath, path.extname(zipPath)) || 'imported-project'
  const targetRoot = path.join(defaultProjectDirectory(), base)
  let extractionRoot = targetRoot
  let index = 1
  while (await fsExists(extractionRoot)) {
    extractionRoot = `${targetRoot}-${++index}`
  }
  await fs.mkdir(extractionRoot, { recursive: true })
  await extractZipSafe(zipPath, extractionRoot)
  const { info } = await openProject(extractionRoot)
  return info
}

async function fsExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

const EXPORT_IGNORE = new Set(['.openleaf/build', '.git', 'node_modules'])

/** Build the ZIP archive of a project folder (build output, .git and junk excluded). */
export async function buildProjectZip(root: string, includePdf: boolean): Promise<Buffer> {
  const zip = new JSZip()
  await addFolderToZip(zip, root, root)

  const { mainFile } = await readProjectConfig(root)
  if (includePdf && mainFile) {
    const mainBase = path.basename(mainFile, path.extname(mainFile))
    try {
      const pdfAbs = await resolveInProject(
        root,
        path.join('.openleaf', 'build', mainBase + '.pdf')
      )
      zip.file(`${mainBase}.pdf`, await fs.readFile(pdfAbs))
    } catch {
      // Not compiled yet: export the sources only.
    }
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * Export a project folder as a ZIP. Asks for the target file (default: next to
 * the project); returns the written path or null when cancelled.
 */
export async function exportProjectZip(root: string, includePdf: boolean): Promise<string | null> {
  const stat = await fs.stat(root).catch(() => null)
  if (!stat?.isDirectory()) throw new Error(`Project folder not found: ${root}`)

  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const defaultName = `${path.basename(root)}.zip`
  let outPath = path.join(path.dirname(root), defaultName)
  if (window) {
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Export Project as ZIP',
      defaultPath: outPath,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    })
    if (canceled || !filePath) return null
    outPath = filePath
  }

  await fs.writeFile(outPath, await buildProjectZip(root, includePdf))
  return outPath
}

async function addFolderToZip(zip: JSZip, current: string, projectRoot: string): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(current, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const absolute = path.join(current, entry.name)
    const rel = path.relative(projectRoot, absolute).split(path.sep).join('/')
    if (
      EXPORT_IGNORE.has(rel) ||
      JUNK_FILES.has(entry.name) ||
      (entry.name.startsWith('.') && entry.name !== '.openleaf')
    )
      continue
    if (entry.isDirectory()) {
      await addFolderToZip(zip.folder(entry.name)!, absolute, projectRoot)
    } else if (entry.isFile()) {
      const data = await fs.readFile(absolute)
      zip.file(entry.name, data)
    }
  }
}
