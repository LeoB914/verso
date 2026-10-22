import { app } from 'electron'
import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import type { RegistryEntry } from '@shared/ipc'
import { getAppStore, getSettings } from '../store'
import { canonicalProjectPath, dedupeProjectEntries } from '../util/project-paths'
import { historyDir } from '../history/snapshots'

/** Project registry: known projects with tags, shown in the dashboard. */

function registerProjectPath(root: string): void {
  const store = getAppStore()
  // Collapse path variants before adding/updating so the same folder never
  // appears twice (symlinks, trailing slashes, old buggy dev entries).
  const projects = dedupeProjectEntries(store.get('projects'))
  const canonical = canonicalProjectPath(root)
  const existing = projects.find((p) => p.path === canonical)
  if (existing) {
    existing.lastOpened = Date.now()
  } else {
    projects.push({
      path: canonical,
      name: path.basename(canonical),
      lastOpened: Date.now(),
      tags: [],
    })
  }
  store.set('projects', projects)
}

export function listProjects(): RegistryEntry[] {
  const store = getAppStore()
  return dedupeProjectEntries(store.get('projects')).map((p) => ({
    ...p,
    exists: fs.existsSync(p.path),
  }))
}

export function removeProject(root: string): void {
  const store = getAppStore()
  const canonical = canonicalProjectPath(root)
  store.set(
    'projects',
    dedupeProjectEntries(store.get('projects')).filter((p) => p.path !== canonical)
  )
}

export function setProjectTags(root: string, tags: string[]): RegistryEntry | null {
  const store = getAppStore()
  const canonical = canonicalProjectPath(root)
  const projects = dedupeProjectEntries(store.get('projects'))
  const project = projects.find((p) => p.path === canonical)
  if (!project) return null
  project.tags = tags
  store.set('projects', projects)
  return { ...project, exists: fs.existsSync(project.path) }
}

/** Merge the given UI state into the registry entry for the project. */
export function saveProjectUiState(root: string, uiState: Record<string, unknown>): void {
  const store = getAppStore()
  const canonical = canonicalProjectPath(root)
  const projects = dedupeProjectEntries(store.get('projects'))
  const project = projects.find((p) => p.path === canonical)
  if (!project) return
  project.uiState = { ...project.uiState, ...uiState }
  store.set('projects', projects)
}

/** Read the persisted UI state for the project (empty object if unknown). */
export function getProjectUiState(root: string): Record<string, unknown> {
  const store = getAppStore()
  const canonical = canonicalProjectPath(root)
  const project = dedupeProjectEntries(store.get('projects')).find((p) => p.path === canonical)
  return project?.uiState ?? {}
}

export function renameProjectEntry(oldPath: string, newPath: string): void {
  const store = getAppStore()
  const projects = dedupeProjectEntries(store.get('projects'))
  const canonicalNew = canonicalProjectPath(newPath)
  const project = projects.find((p) => p.path === canonicalProjectPath(oldPath))
  if (project) {
    project.path = canonicalNew
    project.name = path.basename(canonicalNew)
  } else {
    projects.push({
      path: canonicalNew,
      name: path.basename(canonicalNew),
      lastOpened: Date.now(),
      tags: [],
    })
  }
  store.set('projects', dedupeProjectEntries(projects))
}

export function locateProject(oldPath: string, newPath: string): void {
  const store = getAppStore()
  const canonicalOld = canonicalProjectPath(oldPath)
  const canonicalNew = canonicalProjectPath(newPath)
  const projects = dedupeProjectEntries(store.get('projects'))
  const project = projects.find((entry) => entry.path === canonicalOld)
  if (project) {
    project.path = canonicalNew
    project.name = path.basename(canonicalNew)
  } else {
    projects.push({
      path: canonicalNew,
      name: path.basename(canonicalNew),
      lastOpened: Date.now(),
      tags: [],
    })
  }
  store.set('projects', dedupeProjectEntries(projects))
  if (store.get('lastProjectPath') === canonicalOld) store.set('lastProjectPath', canonicalNew)
  // A moved folder keeps its version history.
  void moveHistory(historyDir(canonicalOld), historyDir(canonicalNew))
}

export { registerProjectPath }

/** Rename a project folder on disk (after confirmation in the UI). */
export async function renameProjectFolder(
  oldPath: string,
  newName: string
): Promise<string | null> {
  if (!newName || /[\\/]/.test(newName) || newName.startsWith('.')) return null
  const parent = path.dirname(oldPath)
  const newPath = path.join(parent, newName)
  if (fs.existsSync(newPath)) return null
  const oldHistory = historyDir(canonicalProjectPath(oldPath))
  await fsPromises.rename(oldPath, newPath)
  renameProjectEntry(oldPath, newPath)
  await moveHistory(oldHistory, historyDir(canonicalProjectPath(newPath)))
  const store = getAppStore()
  if (store.get('lastProjectPath') === oldPath) store.set('lastProjectPath', newPath)
  return newPath
}

/** Duplicate a project folder (excluding build artifacts). */
export async function duplicateProject(oldPath: string): Promise<string | null> {
  const base = path.basename(oldPath)
  const parent = path.dirname(oldPath)
  let candidate = `${base} copy`
  let index = 1
  while (fs.existsSync(path.join(parent, candidate))) {
    candidate = `${base} copy ${++index}`
  }
  const newPath = path.join(parent, candidate)
  await copyProjectFolder(oldPath, newPath)
  // The copy gets its own entry (with the original's tags); the original
  // entry stays untouched.
  const store = getAppStore()
  const projects = dedupeProjectEntries(store.get('projects'))
  const original = projects.find((p) => p.path === canonicalProjectPath(oldPath))
  const canonicalNew = canonicalProjectPath(newPath)
  projects.push({
    path: canonicalNew,
    name: path.basename(canonicalNew),
    lastOpened: Date.now(),
    tags: [...(original?.tags ?? [])],
  })
  store.set('projects', dedupeProjectEntries(projects))
  return newPath
}

/**
 * Version history is keyed by the project path; carry it over when the folder
 * is renamed (never overwrite an existing history at the new location).
 */
async function moveHistory(from: string, to: string): Promise<void> {
  if (from === to || !fs.existsSync(from) || fs.existsSync(to)) return
  await fsPromises.mkdir(path.dirname(to), { recursive: true })
  await fsPromises.rename(from, to).catch(() => undefined)
}

export async function copyProjectFolder(src: string, dest: string): Promise<void> {
  await fsPromises.cp(src, dest, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(src, source)
      return !['.openleaf/build', '.git', 'node_modules'].some(
        (ignored) => rel === ignored || rel.startsWith(ignored + path.sep)
      )
    },
  })
}

/** Move a project folder to the OS trash (never hard delete). */
export async function trashProject(root: string): Promise<void> {
  const { shell } = await import('electron')
  await shell.trashItem(root)
  removeProject(root)
}

export function revealProject(root: string): void {
  void import('electron').then(({ shell }) => shell.showItemInFolder(root))
}

export function defaultProjectDirectory(): string {
  // Settings value first, then the legacy top-level store key (still honoured
  // for existing config files and used by the E2E suite).
  const configured = getSettings().defaultProjectDir ?? getAppStore().get('defaultProjectDir')
  if (configured) return configured
  const documents = app.getPath('documents')
  // Existing installations keep their OpenLeaf projects folder; new installs
  // use the Verso folder. This is the "where all my projects are" default.
  const legacy = path.join(documents, 'OpenLeaf')
  return fs.existsSync(legacy) ? legacy : path.join(documents, 'Verso')
}
