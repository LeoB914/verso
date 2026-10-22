import { app, dialog } from 'electron'
import * as path from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { createMainWindow, getMainWindow, setAppTheme, setupAppLifecycle } from './window'
import { findProjectDirectoryArg } from './util/cli'
import { installApplicationMenu } from './menu'
import { handleProjectProtocol, registerProjectProtocol } from './protocol'
import { getSettings } from './store'
import {
  closeCurrentProject,
  detectEnvironmentOnce,
  openProjectByPath,
  registerIpcHandlers,
} from './ipc/handlers'

/**
 * E2E/test launches get an isolated userData dir (OPENLEAF_USER_DATA_DIR) and
 * skip the single-instance lock, so consecutive test launches never collide.
 * The env var is only honoured in test mode to keep production unaffected.
 */
function isTestMode(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.argv.includes('--e2e') ||
    process.env.OPENLEAF_SKIP_CLOSE_PROMPT === '1'
  )
}

const userDataDir = process.env.OPENLEAF_USER_DATA_DIR
if (userDataDir && isTestMode()) {
  app.setPath('userData', userDataDir)
  // The lock file lives inside userData; a fresh dir always has a free lock.
}

/**
 * Single-instance lock: focus the existing window instead. In test mode the
 * lock is skipped so parallel/consecutive E2E launches cannot steal focus or
 * attach to the wrong window.
 */
const hasSingleInstanceLock = isTestMode() || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = getMainWindow()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      return
    }
    void createMainWindow()
  })
}

registerProjectProtocol()

app.setAboutPanelOptions({
  applicationName: 'Verso',
  applicationVersion: app.getVersion(),
  copyright: 'A local LaTeX editor',
})

async function openFolderViaDialog(): Promise<void> {
  const win = getMainWindow()
  if (!win) return
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Project Folder',
    buttonLabel: 'Open',
  })
  if (!result.canceled && result.filePaths.length > 0) {
    await openProjectByPath(result.filePaths[0])
  }
}

let cliProjectHandled = false
let pendingOpenFile: string | null = null

/** Open a `.tex` file from Finder/Explorer/CLI in its containing project. */
async function openFileFromShell(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return
  const absolute = path.resolve(filePath)
  const projectRoot = path.dirname(absolute)
  await openProjectByPath(projectRoot)
  const relPath = path.basename(absolute)
  const window = getMainWindow()
  window?.webContents.send('editor:open-file', { relPath })
}

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) void openFileFromShell(filePath).catch(() => undefined)
  else pendingOpenFile = filePath
})

async function bootstrap(): Promise<void> {
  if (!hasSingleInstanceLock) return
  // Apply the persisted app theme before any window exists.
  setAppTheme(getSettings().appTheme)
  await handleProjectProtocol()
  await detectEnvironmentOnce()

  registerIpcHandlers(() => void openFolderViaDialog())

  installApplicationMenu({
    runCommand: (id) => {
      const window = getMainWindow()
      window?.webContents.send('menu:command', id)
    },
    openRecent: (recentPath) => {
      const window = getMainWindow()
      window?.webContents.send('menu:open-recent', recentPath)
    },
  })

  await createMainWindow()

  // Only the first launch may open a CLI project. On macOS the process stays
  // alive when the window is closed; a later dock-activate must start on the
  // dashboard, not replay the original argv.
  if (!cliProjectHandled) {
    cliProjectHandled = true
    // Only an explicit absolute directory (file association, "Open with",
    // tests) opens a project. electron-vite passes `.` in dev; that and the
    // app's own directory must never count as a project.
    const cliDir = findProjectDirectoryArg(process.argv.slice(1), {
      cwd: process.cwd(),
      appPath: app.getAppPath(),
    })
    if (cliDir) {
      await openProjectByPath(cliDir)
    } else {
      // Windows/Linux file associations pass a `.tex` file, not a folder.
      const cliFile = process.argv
        .slice(1)
        .find(
          (arg) =>
            path.isAbsolute(arg) && /\.tex$/i.test(arg) && existsSync(arg) && statSync(arg).isFile()
        )
      if (cliFile) await openFileFromShell(cliFile)
    }
  }

  if (pendingOpenFile) {
    const file = pendingOpenFile
    pendingOpenFile = null
    await openFileFromShell(file).catch(() => undefined)
  }
}

setupAppLifecycle(bootstrap)

app.on('before-quit', () => {
  // Stop a running latexmk so quitting never waits for a long compile.
  void import('./tex/compile').then(({ cancelCompile }) => cancelCompile())
  closeCurrentProject()
})
