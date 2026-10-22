import { dialog, BrowserWindow, systemPreferences } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type {
  CompileStatus,
  Compiler,
  PdfGotoPayload,
  ProjectConfig,
  ProjectInfo,
  RecoveryInfo,
} from '@shared/ipc'
import { parseLog, countErrors } from '@shared/latex/log-parser'
import { arxivAtomToBibtex, classifyBibIdentifier } from '@shared/latex/bib-import'
import { getAppStore, getSettings, patchSettings } from '../store'
import {
  openProject,
  projectBuildDir,
  readProjectConfig,
  writeProjectConfig,
} from '../project/config'
import {
  ensureBuildIgnored,
  listFileTree,
  readFileInProject,
  writeFileInProject,
} from '../project/files'
import { detectTexEnvironment } from '../tex/detect'
import { cancelCompile, compile, findCompiledPdf } from '../tex/compile'
import { setProtocolProjectRoot } from '../protocol'
import { resolveSystemPath } from '../env/paths'
import { replaceAllInProject, runProjectSearch } from '../project/search'
import { handleDirtyTabReply, setAppTheme } from '../window'
import { synctexForward, synctexBackward } from '../tex/synctex'
import { runWordCount } from '../tex/wordcount'
import { clearRecovery, loadRecovery, saveRecovery } from '../recovery'
import { resolveInProject } from '../util/paths'
import {
  listProjects,
  removeProject,
  setProjectTags,
  renameProjectFolder,
  duplicateProject,
  trashProject,
  revealProject,
  defaultProjectDirectory,
  registerProjectPath,
  saveProjectUiState,
  getProjectUiState,
  locateProject,
} from '../project/registry'
import {
  listTemplates,
  instantiateTemplate,
  saveProjectAsTemplate,
  deleteUserTemplate,
} from '../project/templates'
import { importZipProject, importZipFromPath, exportProjectZip } from '../project/zip'
import {
  createFileOrFolder,
  renameOrMove,
  duplicatePath,
  trashPath,
  importExternalFile,
  importImageBytes,
} from '../project/files'
import { startWatching, stopWatching } from '../project/watcher'
import {
  AUTO_SNAPSHOT_REASON,
  createSnapshot,
  listSnapshots,
  getSnapshotContents,
  getSnapshotImage,
  restoreFile,
  restoreProject,
  pruneSnapshots,
} from '../history/snapshots'
import {
  checkGitAvailable,
  isRepo,
  initRepo,
  getStatus,
  stage,
  unstage,
  commit as gitCommit,
  getLog,
  listBranches,
  createBranch,
  checkoutBranch,
  fetchRemote,
  push,
  pull,
  showFileAtCommit,
  listCommitFiles,
} from '../git/service'
import type { FsChangeEvent } from '@shared/ipc'
import { handleIpc } from './register'
import { canonicalProjectPath } from '../util/project-paths'
import { cancelGitOperation, cancellableGit } from '../git/cancel'

export interface ProjectState {
  root: string
  info: ProjectInfo
}

let currentProject: ProjectState | null = null
let texEnvironment: Awaited<ReturnType<typeof detectTexEnvironment>> | null = null
let resolvedPathDirs: string[] = []
let lastLogEntries: ReturnType<typeof parseLog> = []
let autoSnapshotTimer: ReturnType<typeof setInterval> | null = null

export function getCurrentProject(): ProjectState | null {
  return currentProject
}

/** Test hook: override the open project without touching the filesystem. */
export function setCurrentProjectForTests(state: ProjectState | null): void {
  currentProject = state
}

export function getTexEnvironment(): Awaited<ReturnType<typeof detectTexEnvironment>> | null {
  return texEnvironment
}

export async function detectEnvironmentOnce(): Promise<void> {
  resolvedPathDirs = (await resolveSystemPath()).paths
  texEnvironment = await detectTexEnvironment()
}

function requireProject(): ProjectState {
  if (!currentProject) throw new Error('No project is open')
  return currentProject
}

async function chooseProjectFolder(): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window) return null
  const result = await dialog.showOpenDialog(window, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Project Folder',
    buttonLabel: 'Open',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/** Open a project by path (from dialog or CLI argument). */
export async function openProjectByPath(root: string): Promise<ProjectInfo> {
  // Resolve symlinks/trailing slashes once: every consumer (registry, watcher,
  // SyncTeX, protocol) then agrees on one canonical project path.
  const canonicalRoot = await fs.realpath(root).catch(() => path.resolve(root))
  const settings = getSettings()
  const { info } = await openProject(canonicalRoot, {
    // Defaults only apply when the project has no config yet.
    compiler: settings.defaultCompiler,
    shellEscape: settings.shellEscapeDefault,
    spellLanguage: settings.spellLanguage,
    spellEnabled: settings.spellEnabled,
  })
  await ensureBuildIgnored(canonicalRoot)
  currentProject = { root: canonicalRoot, info }
  setProtocolProjectRoot(canonicalRoot)
  registerProjectPath(canonicalRoot)
  if (autoSnapshotTimer) clearInterval(autoSnapshotTimer)
  autoSnapshotTimer = setInterval(
    () => void createSnapshot(canonicalRoot, AUTO_SNAPSHOT_REASON).catch(() => undefined),
    5 * 60_000
  )
  void import('../menu').then(({ rebuildApplicationMenu }) => rebuildApplicationMenu())
  // Snapshot on open + schedule retention pruning.
  void createSnapshot(canonicalRoot, 'Project opened').catch(() => undefined)
  void pruneSnapshots(canonicalRoot).catch(() => undefined)
  getAppStore().set('lastProjectPath', canonicalRoot)
  // Watch the project for external changes.
  void startWatching(canonicalRoot, (event: FsChangeEvent) => {
    const main = BrowserWindow.getAllWindows()[0]
    main?.webContents.send('fs:changed', event)
  })
  // Let the renderer know (it may not have initiated this open).
  BrowserWindow.getAllWindows()[0]?.webContents.send('project:opened', info)
  return info
}

export function closeCurrentProject(): void {
  if (autoSnapshotTimer) {
    clearInterval(autoSnapshotTimer)
    autoSnapshotTimer = null
  }
  currentProject = null
  lastPdfRelPath = null
  setProtocolProjectRoot(null)
  getAppStore().set('lastProjectPath', null)
  void import('../menu').then(({ rebuildApplicationMenu }) => rebuildApplicationMenu())
  void stopWatching()
}

function sendCompileStatus(status: CompileStatus): void {
  const window = BrowserWindow.getAllWindows()[0]
  window?.webContents.send('compile:status', status)
}

/** Resolve the compile timeout from settings (clamped to the schema range). */
export function resolveCompileTimeout(settings: { compileTimeoutMs?: number }): number {
  const value = settings.compileTimeoutMs ?? 120_000
  return Math.min(Math.max(value, 10_000), 600_000)
}

/** Last produced PDF (relative path), carried across compiling/canceled states. */
let lastPdfRelPath: string | null = null

/**
 * Incremented per compile run. A run that was superseded (a newer compile
 * cancelled it) must not report its late "canceled" status or overwrite the
 * newer run's log entries.
 */
let compileGeneration = 0

/** Tell the renderer that the app (not the editor) changed a project file. */
function notifyFileChangedByApp(relPath: string): void {
  const window = BrowserWindow.getAllWindows()[0]
  window?.webContents.send('file:changedByApp', { relPath })
}

export async function runCompile(compiler?: Compiler, fresh = false): Promise<void> {
  const project = currentProject
  const env = texEnvironment
  if (!project || !env?.tools.latexmk) {
    sendCompileStatus({
      state: 'error',
      message: 'TeX environment not found. Install a TeX distribution.',
    })
    return
  }

  const config = project.info.config
  const usedCompiler = compiler ?? config.compiler
  if (!config.mainFile) {
    sendCompileStatus({
      state: 'error',
      message: 'No main file set. Choose one in the project settings.',
    })
    return
  }

  const mainFile = path.resolve(project.root, config.mainFile)
  const outDir = projectBuildDir(project.root)
  await fs.mkdir(outDir, { recursive: true })

  // Carry the last produced PDF through the compiling/canceled states so the
  // PDF pane keeps showing it (and stays mounted, preserving scroll position).
  const generation = ++compileGeneration
  sendCompileStatus({ state: 'compiling', pdfRelPath: lastPdfRelPath })
  const started = Date.now()

  const compileSettings = getSettings()
  const timeoutMs = resolveCompileTimeout(compileSettings)
  const outcome = await compile(
    {
      latexmkPath: env.tools.latexmk.path,
      compiler: usedCompiler,
      mainFile,
      outDir,
      pathDirs: resolvedPathDirs,
      shellEscape: config.shellEscape,
      timeoutMs,
      fresh,
    },
    () => {
      /* stdout could stream into a console panel later */
    }
  )
  if (generation !== compileGeneration) return

  // Parse the log from the build directory (latexmk writes <name>.log there).
  const logBase = path.basename(mainFile, path.extname(mainFile))
  let entries: ReturnType<typeof parseLog> = []
  try {
    const logContent = await readFileInProject(
      project.root,
      path.join('.openleaf', 'build', logBase + '.log')
    )
    // latexmk is invoked with an absolute main file, so error prefixes in the
    // log can be absolute; the renderer works with project-relative paths.
    entries = parseLog(logContent.content).map((e) =>
      e.file && path.isAbsolute(e.file) ? { ...e, file: path.relative(project.root, e.file) } : e
    )
  } catch {
    entries = []
  }

  const durationMs = Date.now() - started
  const pdfAbs = await findCompiledPdf(mainFile, outDir)
  // A newer run may have started while the log/PDF were read.
  if (generation !== compileGeneration) return
  lastLogEntries = entries
  const pdfRelPath = pdfAbs ? path.relative(project.root, pdfAbs).split(path.sep).join('/') : null
  if (pdfRelPath) lastPdfRelPath = pdfRelPath

  if (outcome.canceled) {
    sendCompileStatus({ state: 'canceled', durationMs, pdfRelPath: pdfRelPath ?? lastPdfRelPath })
  } else if (outcome.timedOut) {
    sendCompileStatus({
      state: 'error',
      durationMs,
      pdfRelPath: pdfRelPath ?? lastPdfRelPath,
      message: `Compilation timed out (${Math.round(timeoutMs / 1000)} s).`,
    })
  } else if (outcome.code === 0 && pdfRelPath) {
    sendCompileStatus({
      state: 'success',
      durationMs,
      errorCount: countErrors(entries),
      pdfRelPath,
    })
    // Snapshot after every successful compile (retention-pruned lazily).
    void createSnapshot(project.root, 'Compiled', undefined, undefined).catch(() => undefined)
  } else {
    sendCompileStatus({
      state: 'error',
      durationMs,
      errorCount: countErrors(entries),
      pdfRelPath,
      message: 'Compilation failed — check the problem list.',
    })
  }
}

let ipcHandlersRegistered = false

export function registerIpcHandlers(openFolderFromMenu: () => void): void {
  // macOS can re-run bootstrap when the window is recreated; ipcMain.handle
  // throws on a duplicate registration.
  if (ipcHandlersRegistered) return
  ipcHandlersRegistered = true

  handleIpc('project:choose', async () => {
    const chosen = await chooseProjectFolder()
    if (!chosen) return null
    return openProjectByPath(chosen)
  })

  handleIpc('project:open', async (input) => {
    return openProjectByPath(input.path)
  })

  handleIpc('project:close', () => {
    closeCurrentProject()
    return null
  })

  handleIpc('project:getCurrent', () => currentProject?.info ?? null)

  handleIpc('project:setConfig', async (input) => {
    const project = requireProject()
    const config = await readProjectConfig(project.root)
    const merged: ProjectConfig = { ...config, ...input.patch }
    await writeProjectConfig(project.root, merged)
    project.info.config = merged
    return merged
  })

  handleIpc('project:getUiState', () => {
    const project = currentProject
    if (!project) return {}
    return getProjectUiState(project.root)
  })

  handleIpc('project:saveUiState', (input) => {
    const project = currentProject
    if (project) saveProjectUiState(project.root, input.uiState)
    return input.uiState
  })

  handleIpc('project:listTree', async () => {
    const project = requireProject()
    return listFileTree(project.root)
  })

  handleIpc('file:read', async (input) => {
    const project = requireProject()
    return readFileInProject(project.root, input.relPath)
  })

  handleIpc('file:write', async (input) => {
    const project = requireProject()
    // CRLF/BOM are preserved from the file on disk. A file deleted outside the
    // app while its tab was open is recreated instead of failing the save.
    const existing = await readFileInProject(project.root, input.relPath).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    })
    return writeFileInProject(
      project.root,
      input.relPath,
      input.content,
      existing ? input.expectedMtime : null,
      { crlf: existing?.crlf ?? false, bom: existing?.hadBom ?? false }
    )
  })

  handleIpc('tex:detect', async () => {
    if (!texEnvironment) await detectEnvironmentOnce()
    return texEnvironment!
  })

  handleIpc('compile:start', async (input) => {
    void runCompile(input.compiler).catch((err: unknown) => {
      sendCompileStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    })
    return { started: true }
  })

  handleIpc('compile:cancel', () => {
    return { canceled: cancelCompile() }
  })

  handleIpc('compile:log', () => {
    return lastLogEntries
  })

  handleIpc('settings:get', () => {
    const settings = getSettings()
    return {
      ...settings,
      defaultProjectDir: settings.defaultProjectDir ?? defaultProjectDirectory(),
    }
  })

  handleIpc('settings:set', (input) => {
    const updated = patchSettings(input.patch as Record<string, unknown>)
    // Apply live: app theme (window chrome in main + renderer via event).
    setAppTheme(updated.appTheme)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('app:theme', updated.appTheme)
      window.webContents.send('app:settings', updated)
    }
    // Accent: push to all windows.
    const accent = updated.accentOverride ?? getSystemAccent()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('app:accent', accent)
    }
    // Keybinding overrides must reach the native menu immediately.
    void import('../menu').then(({ rebuildApplicationMenu }) => rebuildApplicationMenu())
    return { ...updated, defaultProjectDir: updated.defaultProjectDir ?? defaultProjectDirectory() }
  })

  handleIpc('menu:popup', async (input) => {
    const { Menu, MenuItem, BrowserWindow } = await import('electron')
    const requestId = Math.random().toString(36).slice(2)
    const menu = new Menu()
    for (const item of input.items) {
      menu.append(
        new MenuItem({
          label: item.label,
          type: item.type ?? 'normal',
          enabled: item.enabled ?? true,
          click: () => resolvePopupResult(requestId, item.id),
        })
      )
    }
    menu.popup({
      window: BrowserWindow.getFocusedWindow() ?? undefined,
      callback: () => {
        // Popup closed without a click → resolve null shortly after (a click
        // handler may still be in flight).
        setTimeout(() => resolvePopupResult(requestId, ''), 150)
      },
    })
    return await new Promise<string | null>((resolve) => {
      pendingPopupResolves.set(requestId, (id) => resolve(id === '' ? null : id))
    })
  })

  handleIpc('dialog:confirm', async (input) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!window) return false
    const { dialog } = await import('electron')
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: input.title,
      message: input.title,
      detail: input.message,
      buttons: [input.confirmLabel ?? 'OK', input.cancelLabel ?? 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    return result.response === 0
  })

  handleIpc('project:dictionary', async () => {
    const project = requireProject()
    try {
      const content = await readFileInProject(project.root, '.openleaf/dictionary.txt')
      return content.content.split(/\r?\n/).filter(Boolean)
    } catch {
      return []
    }
  })

  handleIpc('project:dictionary:add', async (input) => {
    const project = requireProject()
    const dictPath = '.openleaf/dictionary.txt'
    let words: string[] = []
    try {
      const content = await readFileInProject(project.root, dictPath)
      words = content.content.split(/\r?\n/).filter(Boolean)
    } catch {
      words = []
    }
    if (!words.includes(input.word)) {
      words.push(input.word)
      await writeFileInProject(project.root, dictPath, words.join('\n') + '\n', null, {
        crlf: false,
        bom: false,
      })
    }
    return null
  })

  handleIpc('search:run', (input) => {
    void runProjectSearch(input.query, input.options).catch(() => undefined)
    return null
  })

  handleIpc('search:replaceAll', async (input) => {
    const changedFiles = await replaceAllInProject(
      input.query,
      input.options,
      input.replacement,
      input.relPaths
    )
    for (const relPath of changedFiles) notifyFileChangedByApp(relPath)
    return { changedFiles }
  })

  handleIpc('app:dirtyTabsReply', (input) => {
    handleDirtyTabReply(input.requestId, input.count)
    return null
  })

  handleIpc('compile:fresh', async () => {
    const project = currentProject
    if (project) {
      // Clear the build directory, then run latexmk -gg.
      await fs.rm(projectBuildDir(project.root), { recursive: true, force: true })
    }
    void runCompile(undefined, true).catch((err: unknown) => {
      sendCompileStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    })
    return { started: true }
  })

  handleIpc('synctex:forward', async (input) => {
    const result = await synctexForward(input.relPath, input.line, input.column)
    if (result) {
      const payload: PdfGotoPayload = {
        page: result.page,
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
      }
      // Route to the detached PDF window if open, otherwise the main window.
      const target =
        pdfWindow && !pdfWindow.isDestroyed() ? pdfWindow : BrowserWindow.getAllWindows()[0]
      target?.webContents.send('pdf:goto', payload)
    }
    return result
  })

  handleIpc('synctex:backward', async (input) => {
    const result = await synctexBackward(input.page, input.x, input.y)
    if (result) {
      const main = BrowserWindow.getAllWindows().find((w) => w !== pdfWindow)
      main?.webContents.send('editor:goto', {
        relPath: result.file,
        line: result.line,
        column: result.column,
      })
    }
    return result
  })

  handleIpc('wordcount:run', async () => {
    return runWordCount()
  })

  handleIpc('pdf:openExternal', async () => {
    const project = currentProject
    if (!project || !project.info.config.mainFile) return null
    const { shell } = await import('electron')
    const mainBase = path.basename(
      project.info.config.mainFile,
      path.extname(project.info.config.mainFile)
    )
    try {
      const pdfAbs = await resolveInProject(
        project.root,
        path.join('.openleaf', 'build', mainBase + '.pdf')
      )
      await shell.openPath(pdfAbs)
    } catch {
      // PDF may not exist yet.
    }
    return null
  })

  handleIpc('pdf:detach', async () => {
    await detachPdfWindow()
    return null
  })

  handleIpc('projects:list', () => {
    return listProjects()
  })

  handleIpc('projects:remove', (input) => {
    removeProject(input.path)
    return null
  })

  handleIpc('projects:setTags', (input) => {
    return setProjectTags(input.path, input.tags)
  })

  handleIpc('projects:locate', async (input) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Locate project folder',
      buttonLabel: 'Use this folder',
      defaultPath: path.dirname(input.path),
    })
    if (result.canceled || result.filePaths.length === 0) return null
    locateProject(input.path, result.filePaths[0])
    void import('../menu').then(({ rebuildApplicationMenu }) => rebuildApplicationMenu())
    const located = canonicalProjectPath(result.filePaths[0])
    return listProjects().find((entry) => entry.path === located) ?? null
  })

  handleIpc('projects:reveal', (input) => {
    revealProject(input.path)
    return null
  })

  handleIpc('projects:trash', async (input) => {
    await trashProject(input.path)
    return null
  })

  handleIpc('projects:duplicate', async (input) => {
    const newPath = await duplicateProject(input.path)
    return newPath ? { newPath } : null
  })

  handleIpc('projects:rename', async (input) => {
    const newPath = await renameProjectFolder(input.path, input.newName)
    if (!newPath) return null
    const { openProject } = await import('../project/config')
    const { info } = await openProject(newPath)
    return info
  })

  handleIpc('dialog:chooseDirectory', async (input) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      title: input.title ?? 'Choose folder',
      buttonLabel: 'Choose',
      defaultPath: input.defaultPath,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  handleIpc('templates:list', () => {
    return listTemplates()
  })

  handleIpc('templates:instantiate', async (input) => {
    const target = input.parentDir ?? defaultProjectDirectory()
    const projectPath = await instantiateTemplate(input.templateId, input.name, target)
    if (!projectPath) return null
    return openProjectByPath(projectPath)
  })

  handleIpc('templates:saveFromProject', async (input) => {
    return saveProjectAsTemplate(input.path, input.name)
  })

  handleIpc('templates:delete', (input) => {
    deleteUserTemplate(input.templateId)
    return null
  })

  handleIpc('zip:import', async () => {
    return importZipProject()
  })

  handleIpc('zip:importFrom', async (input) => {
    return importZipFromPath(input.zipPath)
  })

  handleIpc('zip:export', async (input) => {
    return exportProjectZip(input.path, input.includePdf)
  })

  handleIpc('files:create', async (input) => {
    const project = requireProject()
    await createFileOrFolder(project.root, input.relPath, input.type, input.content ?? '')
    return null
  })

  handleIpc('files:rename', async (input) => {
    const project = requireProject()
    await renameOrMove(project.root, input.relPath, input.target)
    return null
  })

  handleIpc('files:delete', async (input) => {
    const project = requireProject()
    await trashPath(project.root, input.relPath)
    return null
  })

  handleIpc('files:duplicate', async (input) => {
    const project = requireProject()
    return { target: await duplicatePath(project.root, input.relPath) }
  })

  handleIpc('files:move', async (input) => {
    const project = requireProject()
    await renameOrMove(project.root, input.relPath, input.target)
    return null
  })

  handleIpc('files:readMany', async (input) => {
    const project = requireProject()
    const result: Record<string, string> = {}
    for (const relPath of input.relPaths) {
      try {
        const file = await readFileInProject(project.root, relPath)
        result[relPath] = file.content
      } catch {
        // Skip unreadable files.
      }
    }
    return result
  })

  handleIpc('files:writeMany', async (input) => {
    const project = requireProject()
    for (const file of input.files) {
      // A missing target is created (e.g. the first references.bib entry).
      const existing = await readFileInProject(project.root, file.relPath).catch(() => null)
      await writeFileInProject(project.root, file.relPath, file.content, existing?.mtime ?? null, {
        crlf: existing?.crlf ?? false,
        bom: existing?.hadBom ?? false,
      })
      notifyFileChangedByApp(file.relPath)
    }
    return null
  })

  handleIpc('files:importImageBytes', async (input) => {
    const project = requireProject()
    const relPath = await importImageBytes(
      project.root,
      input.name,
      input.data,
      input.targetDir ?? 'figures'
    )
    return { relPath }
  })

  handleIpc('files:importDropped', async (input) => {
    const project = requireProject()
    const target = await importExternalFile(
      project.root,
      input.sourcePath,
      input.targetDir ?? 'figures'
    )
    return target ? { relPath: target } : null
  })

  handleIpc('files:pickImage', async () => {
    const project = requireProject()
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: 'Insert image',
      buttonLabel: 'Insert',
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'eps', 'svg', 'pdf'],
        },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const target = await importExternalFile(project.root, result.filePaths[0], 'figures')
    return target ? { relPath: target } : null
  })

  handleIpc('files:applyReferenceUpdates', async (input) => {
    const project = requireProject()
    const files: Record<string, string> = {}
    for (const update of input.updates) {
      if (files[update.relPath] === undefined) {
        try {
          files[update.relPath] = (await readFileInProject(project.root, update.relPath)).content
        } catch {
          continue
        }
      }
    }
    const { applyReferenceUpdates } = await import('@shared/latex/references')
    const updated = applyReferenceUpdates(files, input.updates as never)
    for (const [relPath, content] of Object.entries(updated)) {
      if (content === files[relPath]) continue
      const existing = await readFileInProject(project.root, relPath)
      await writeFileInProject(project.root, relPath, content, existing.mtime, {
        crlf: existing.crlf,
        bom: existing.hadBom,
      })
      notifyFileChangedByApp(relPath)
    }
    return null
  })

  handleIpc('history:snapshot', async (input) => {
    const project = requireProject()
    return createSnapshot(project.root, input.reason, input.label, input.overrides)
  })

  handleIpc('history:list', async () => {
    const project = requireProject()
    await pruneSnapshots(project.root).catch(() => undefined)
    return listSnapshots(project.root)
  })

  handleIpc('history:fileContent', async (input) => {
    const project = requireProject()
    const contents = await getSnapshotContents(project.root, input.snapshotId)
    return contents?.[input.relPath] ?? null
  })

  handleIpc('history:imageContent', async (input) => {
    const project = requireProject()
    const dataUrl = await getSnapshotImage(project.root, input.snapshotId, input.relPath)
    return dataUrl ? { dataUrl } : null
  })

  handleIpc('history:exportZip', async (input) => {
    const project = requireProject()
    const contents = await getSnapshotContents(project.root, input.snapshotId)
    if (!contents) return false
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!window) return false
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Export snapshot as ZIP',
      defaultPath: `snapshot-${input.snapshotId}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    })
    if (canceled || !filePath) return false
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    for (const [relPath, content] of Object.entries(contents)) zip.file(relPath, content)
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await fs.writeFile(filePath, buffer)
    return true
  })

  handleIpc('history:restoreFile', async (input) => {
    const project = requireProject()
    const restored = await restoreFile(
      project.root,
      input.snapshotId,
      input.relPath,
      input.overrides
    )
    if (restored) notifyFileChangedByApp(input.relPath)
    return restored
  })

  handleIpc('history:restoreProject', async (input) => {
    const project = requireProject()
    const restored = await restoreProject(project.root, input.snapshotId, input.overrides)
    if (restored === null) return false
    // Open tabs must pick up the restored content instead of saving over it.
    for (const relPath of restored) notifyFileChangedByApp(relPath)
    return true
  })

  handleIpc('git:available', async () => {
    return checkGitAvailable()
  })

  handleIpc('git:status', async () => {
    const project = requireProject()
    if (!isRepo(project.root)) return null
    return getStatus(project.root)
  })

  handleIpc('git:init', async () => {
    const project = requireProject()
    await initRepo(project.root)
    return null
  })

  handleIpc('git:stage', async (input) => {
    const project = requireProject()
    await stage(project.root, input.paths)
    return null
  })

  handleIpc('git:unstage', async (input) => {
    const project = requireProject()
    await unstage(project.root, input.paths)
    return null
  })

  handleIpc('git:commit', async (input) => {
    const project = requireProject()
    return gitCommit(project.root, input.message, input.amend)
  })

  handleIpc('git:log', async () => {
    const project = requireProject()
    return getLog(project.root)
  })

  handleIpc('git:branches', async () => {
    const project = requireProject()
    return listBranches(project.root)
  })

  handleIpc('git:createBranch', async (input) => {
    const project = requireProject()
    await createBranch(project.root, input.name)
    return null
  })

  handleIpc('git:checkout', async (input) => {
    const project = requireProject()
    await checkoutBranch(project.root, input.name)
    return null
  })

  handleIpc('git:fetch', async () => {
    const project = requireProject()
    return cancellableGit(fetchRemote(project.root))
  })

  handleIpc('git:cancel', () => {
    cancelGitOperation()
    return null
  })

  handleIpc('git:push', async (input) => {
    const project = requireProject()
    return cancellableGit(push(project.root, input.setUpstream))
  })

  handleIpc('git:pull', async () => {
    const project = requireProject()
    return cancellableGit(pull(project.root))
  })

  handleIpc('git:commitFiles', async (input) => {
    const project = requireProject()
    return listCommitFiles(project.root, input.commitHash)
  })

  handleIpc('git:fileAtCommit', async (input) => {
    const project = requireProject()
    return showFileAtCommit(project.root, input.commitHash, input.relPath)
  })

  handleIpc('bib:fetchDoi', async (input) => {
    const identifier = classifyBibIdentifier(input.doi)
    if (!identifier) return null
    const fetchWithTimeout = async (url: string, init: RequestInit = {}): Promise<Response> => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        return await fetch(url, { ...init, signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      if (identifier.kind === 'arxiv') {
        const response = await fetchWithTimeout(
          `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(identifier.id)}`
        )
        if (!response.ok) return null
        return arxivAtomToBibtex(await response.text(), identifier.id)
      }
      if (identifier.kind === 'isbn') {
        const { isbn } = identifier
        const response = await fetchWithTimeout(`https://openlibrary.org/isbn/${isbn}.json`)
        if (!response.ok) return null
        const book = (await response.json()) as {
          title?: string
          authors?: Array<{ name?: string }>
          publish_date?: string
        }
        const author =
          book.authors
            ?.map((entry) => entry.name)
            .filter(Boolean)
            .join(' and ') ?? ''
        const year = book.publish_date?.match(/\d{4}/)?.[0] ?? ''
        const key = `isbn${isbn}`
        const bibtex = [
          `@book{${key},`,
          `  author = {${author}},`,
          `  title = {${book.title ?? ''}},`,
          `  year = {${year}},`,
          `  isbn = {${isbn}},`,
          '}',
        ].join('\n')
        return { bibtex, key }
      }
      const response = await fetchWithTimeout(
        `https://doi.org/${encodeURIComponent(identifier.doi)}`,
        { headers: { Accept: 'application/x-bibtex' } }
      )
      if (!response.ok) return null
      const bibtex = (await response.text()).trim()
      if (!bibtex.startsWith('@')) return null
      const author = /author\s*=\s*[{"']([^}"']+)/i.exec(bibtex)?.[1]
      const year = /year\s*=\s*[{"']?(\d{4})/i.exec(bibtex)?.[1]
      const title = /title\s*=\s*[{"']([^}"']+)/i.exec(bibtex)?.[1]
      const { generateCiteKey } = await import('@shared/latex/bibliography')
      return { bibtex, key: generateCiteKey({ author, year, title }) }
    } catch {
      return null
    }
  })

  handleIpc('chat:send', async (input) => {
    const { streamChat } = await import('../ai/chat')
    void streamChat(input).catch(() => undefined)
    return null
  })

  handleIpc('chat:stop', (input) => {
    void import('../ai/chat').then(({ stopChatStream }) => stopChatStream(input.sessionId))
    return null
  })

  handleIpc('chat:sessions', async (input) => {
    const { listChatSessions } = await import('../ai/chat')
    return listChatSessions(input.projectId)
  })

  handleIpc('chat:saveSession', async (input) => {
    const { saveChatSession } = await import('../ai/chat')
    await saveChatSession(input.session)
    return null
  })

  handleIpc('chat:deleteSession', async (input) => {
    const { deleteChatSession } = await import('../ai/chat')
    await deleteChatSession(input.projectId, input.sessionId)
    return null
  })

  handleIpc('chat:listModels', async (input) => {
    const { listOllamaModels } = await import('../ai/chat')
    return listOllamaModels(input.baseUrl)
  })

  handleIpc('keys:save', async (input) => {
    const { saveApiKey } = await import('../ai/chat')
    await saveApiKey(input.provider, input.key)
    return null
  })

  handleIpc('app:getSettings', () => {
    const settings = getSettings()
    return {
      ...settings,
      defaultProjectDir: settings.defaultProjectDir ?? defaultProjectDirectory(),
      firstRunDone: getAppStore().get('firstRunDone'),
    }
  })

  handleIpc('firstrun:done', () => {
    getAppStore().set('firstRunDone', true)
    return null
  })

  handleIpc('firstrun:reset', () => {
    getAppStore().set('firstRunDone', false)
    return null
  })

  handleIpc('userThemes:list', async () => {
    const { app } = await import('electron')
    const fsMod = await import('node:fs/promises')
    const themesDir = path.join(app.getPath('userData'), 'themes')
    const result: Array<{
      id: string
      name: string
      dark: boolean
      json: string
      error: string | null
    }> = []
    let entries
    try {
      entries = await fsMod.readdir(themesDir, { withFileTypes: true })
    } catch {
      return result
    }
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue
      try {
        const json = await fsMod.readFile(path.join(themesDir, entry.name), 'utf8')
        const parsed = JSON.parse(json) as { id?: string; name?: string; dark?: boolean }
        result.push({
          id: parsed.id ?? entry.name.replace(/\.json$/, ''),
          name: parsed.name ?? entry.name,
          dark: parsed.dark ?? false,
          json,
          error: null,
        })
      } catch (err) {
        result.push({
          id: entry.name,
          name: entry.name,
          dark: false,
          json: '',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return result
  })

  handleIpc('userThemes:openFolder', async () => {
    const { app, shell } = await import('electron')
    const themesDir = path.join(app.getPath('userData'), 'themes')
    await fs.mkdir(themesDir, { recursive: true })
    shell.openPath(themesDir)
    return null
  })

  handleIpc('recovery:save', async (input) => {
    const project = currentProject
    if (!project) return null
    await saveRecovery(project.root, input.buffers)
    return null
  })

  handleIpc('recovery:get', async () => {
    const project = currentProject
    if (!project) return null
    const state = await loadRecovery(project.root)
    if (!state) return null
    // Only offer buffers that actually differ from what is on disk.
    const buffers: RecoveryInfo['buffers'] = []
    for (const buffer of state.buffers) {
      const disk = await readFileInProject(project.root, buffer.relPath).catch(() => null)
      const normalised = buffer.content.replace(/\r\n/g, '\n')
      if (!disk || disk.content !== normalised) buffers.push(buffer)
    }
    return buffers.length > 0 ? { ...state, buffers } : null
  })

  handleIpc('logs:openFolder', async () => {
    const { openLogsFolder } = await import('../logging')
    await openLogsFolder()
    return null
  })

  handleIpc('recovery:clear', async () => {
    const project = currentProject
    if (project) await clearRecovery(project.root)
    return null
  })

  void openFolderFromMenu
}

function getSystemAccent(): string | null {
  try {
    const accent = systemPreferences.getAccentColor?.()
    return accent ? `#${accent.replace(/^#/, '')}` : null
  } catch {
    return null
  }
}

const pendingPopupResolves = new Map<string, (id: string) => void>()

function resolvePopupResult(requestId: string, id: string): void {
  const resolve = pendingPopupResolves.get(requestId)
  if (resolve) {
    pendingPopupResolves.delete(requestId)
    resolve(id)
  }
}

// --- Detached PDF window ---------------------------------------------------

let pdfWindow: BrowserWindow | null = null
let detachedPdfRelPath: string | null = null

export async function detachPdfWindow(): Promise<void> {
  const project = currentProject
  if (!project || pdfWindow) return
  const mainBase = project.info.config.mainFile
    ? path.basename(project.info.config.mainFile, path.extname(project.info.config.mainFile))
    : null
  detachedPdfRelPath = mainBase ? `.openleaf/build/${mainBase}.pdf` : null

  const store = getAppStore()
  const bounds = store.get('pdfWindowBounds')
  const { createDetachedPdfWindow } = await import('../window')
  pdfWindow = createDetachedPdfWindow(bounds, detachedPdfRelPath)

  pdfWindow.on('close', () => {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      store.set('pdfWindowBounds', pdfWindow.getBounds())
    }
    pdfWindow = null
    detachedPdfRelPath = null
    const main = BrowserWindow.getAllWindows()[0]
    main?.webContents.send('pdf:detached', { detached: false, pdfRelPath: null })
  })

  const main = BrowserWindow.getAllWindows()[0]
  main?.webContents.send('pdf:detached', { detached: true, pdfRelPath: detachedPdfRelPath })
}
