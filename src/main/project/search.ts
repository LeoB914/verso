import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { BrowserWindow } from 'electron'
import type { SearchFileResult, SearchOptions } from '@shared/ipc'
import { buildSearchRegex, isSearchableFile, replaceInText, searchInText } from '@shared/search'
import { PathSafetyError, resolveInProject } from '../util/paths'
import { getCurrentProject } from '../ipc/handlers'
import { readFileInProject, writeFileInProject } from './files'

const IGNORED_DIRS = new Set(['.openleaf', '.git', 'node_modules'])

async function collectSearchableFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > 10 || files.length > 2000) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath, depth + 1)
      } else if (entry.isFile() && isSearchableFile(entry.name)) {
        files.push(relPath)
      }
    }
  }
  await walk(root, '', 0)
  return files
}

/** Run a project-wide search, streaming results to the renderer in batches. */
export async function runProjectSearch(query: string, options: SearchOptions): Promise<void> {
  const project = getCurrentProject()
  const window = BrowserWindow.getAllWindows()[0]
  if (!project || !window) return

  const regex = buildSearchRegex(query, options)
  if (!regex) {
    window.webContents.send('search:results', { batch: [], done: true })
    return
  }

  const files = await collectSearchableFiles(project.root)
  const BATCH_SIZE = 20
  let batch: SearchFileResult[] = []

  for (const relPath of files) {
    let content: string
    try {
      const absolute = await resolveInProject(project.root, relPath)
      content = await fs.readFile(absolute, 'utf8')
    } catch {
      continue
    }
    const matches = searchInText(content, regex)
    if (matches.length > 0) {
      batch.push({ relPath, matches })
      if (batch.length >= BATCH_SIZE) {
        window.webContents.send('search:results', { batch, done: false })
        batch = []
      }
    }
  }
  window.webContents.send('search:results', { batch, done: true })
}

/**
 * Replace all matches in the given files (or all project files). Returns the
 * list of files that changed.
 */
export async function replaceAllInProject(
  query: string,
  options: SearchOptions,
  replacement: string,
  relPaths?: string[]
): Promise<string[]> {
  const project = getCurrentProject()
  if (!project) return []
  const regex = buildSearchRegex(query, options)
  if (!regex) return []

  const targets = relPaths ?? (await collectSearchableFiles(project.root))
  const changed: string[] = []

  for (const relPath of targets) {
    try {
      const file = await readFileInProject(project.root, relPath)
      const { text, count } = replaceInText(file.content, regex, replacement)
      if (count > 0 && text !== file.content) {
        await writeFileInProject(project.root, relPath, text, file.mtime, {
          crlf: file.crlf,
          bom: file.hadBom,
        })
        changed.push(relPath)
      }
    } catch (err) {
      if (err instanceof PathSafetyError) continue
      // Skip unreadable files.
    }
  }
  return changed
}
