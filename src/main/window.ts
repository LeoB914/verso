import { buildContentSecurityPolicy } from './csp'
import { BrowserWindow, app, screen, shell } from 'electron'
import * as path from 'node:path'
import { nativeTheme } from 'electron'

/** True when any part of the bounds is on a connected display. */
function isBoundsVisible(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((display) => {
    const { x, y, width, height } = display.bounds
    return (
      bounds.x < x + width &&
      bounds.x + bounds.width > x &&
      bounds.y < y + height &&
      bounds.y + bounds.height > y
    )
  })
}

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Verso',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  }

  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset'
    windowOptions.trafficLightPosition = { x: 12, y: 12 }
    windowOptions.vibrancy = 'sidebar'
    windowOptions.backgroundMaterial = undefined
  } else if (isWindows) {
    windowOptions.titleBarStyle = 'hidden'
    windowOptions.titleBarOverlay = {
      color: nativeTheme.shouldUseDarkColors ? '#00000000' : '#00000000',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
      height: 38,
    }
    // 'mica' where available (Windows 11).
    windowOptions.backgroundMaterial = 'mica'
  }

  // Window state persistence (size/position), guarded against missing displays.
  const { getAppStore } = await import('./store')
  const appStore = getAppStore()
  const savedWindowState = appStore.get('windowBounds')
  if (savedWindowState && isBoundsVisible(savedWindowState)) {
    windowOptions.x = savedWindowState.x
    windowOptions.y = savedWindowState.y
    windowOptions.width = savedWindowState.width
    windowOptions.height = savedWindowState.height
  }

  const window = new BrowserWindow(windowOptions)

  window.on('close', () => {
    const bounds = window.getNormalBounds()
    if (isBoundsVisible(bounds)) {
      appStore.set('windowBounds', bounds)
    }
  })

  window.on('ready-to-show', () => window.show())

  // Unsaved-changes prompt on quit: ask the renderer how many tabs are dirty.
  let forceClose = false
  window.on('close', (event) => {
    if (forceClose) return
    // E2E tests run headless-ish; a native dialog would hang them.
    if (process.env.OPENLEAF_SKIP_CLOSE_PROMPT === '1') {
      forceClose = true
      return
    }
    event.preventDefault()
    void (async () => {
      const count = await queryDirtyTabCount(window)
      if (count > 0) {
        // Make sure the prompt is in front even when the app was in the
        // background (otherwise quitting looks like it hangs).
        app.focus({ steal: true })
        window.focus()
        const { dialog } = await import('electron')
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          title: 'Unsaved changes',
          message:
            count === 1
              ? 'One document has unsaved changes.'
              : `${count} documents have unsaved changes.`,
          detail: 'Do you want to quit anyway?',
          buttons: ['Quit without saving', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
        })
        if (result.response !== 0) return
      }
      forceClose = true
      // destroy() skips further close events; quit() finishes the shutdown on
      // all platforms (the original quit was canceled by preventDefault).
      window.destroy()
      app.quit()
    })()
  })

  // Strict CSP; only development allows the Vite dev server and its inline
  // refresh preamble (see buildContentSecurityPolicy).
  const csp = buildContentSecurityPolicy(process.env.ELECTRON_RENDERER_URL)
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  // External links open in the system browser after validation.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('mailto:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Block all in-window navigation (CSP + single-page app).
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL
    const isDevUrl = allowed !== undefined && url.startsWith(allowed)
    const isInternal = url.startsWith('openleaf://') || url.startsWith('file://')
    if (!isDevUrl && !isInternal) {
      event.preventDefault()
    }
  })

  // Deny every permission request (camera, geolocation, …) — nothing needed.
  window.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    void permission
    callback(false)
  })

  // Renderer crashes reload the window; dirty-buffer recovery restores tabs.
  window.webContents.on('render-process-gone', (_event, details) => {
    void import('./logging').then(({ logError }) =>
      logError(`Renderer gone: ${details.reason} (exitCode ${details.exitCode})`)
    )
    if (details.reason === 'crashed' || details.reason === 'oom') {
      setTimeout(() => {
        if (!window.isDestroyed()) void window.reload()
      }, 500)
    }
  })

  window.on('closed', () => {
    mainWindow = null
    // macOS keeps the process alive after the last window closes. Drop the
    // project so clicking the dock icon starts on the dashboard again instead
    // of reviving the previous project through project:getCurrent.
    void import('./ipc/handlers')
      .then(({ closeCurrentProject }) => closeCurrentProject())
      .catch(() => undefined)
  })

  // Load dev server or production file.
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow = window
  return window
}

export function setAppTheme(theme: 'light' | 'dark' | 'system'): void {
  if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return
  nativeTheme.themeSource = theme
}

/** Create the separate PDF window (same security settings as the main one). */
export function createDetachedPdfWindow(
  bounds: { x: number; y: number; width: number; height: number } | null,
  pdfRelPath: string | null
): BrowserWindow {
  const window = new BrowserWindow({
    width: bounds?.width ?? 700,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    title: 'Verso — PDF',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  const hash = pdfRelPath ? `detached-pdf/${encodeURIComponent(pdfRelPath)}` : 'detached-pdf'
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL + '#' + hash)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), { hash })
  }
  return window
}

// --- Dirty-tab round trip -------------------------------------------------

const pendingDirtyQueries = new Map<string, (count: number) => void>()

export function handleDirtyTabReply(requestId: string, count: number): void {
  const resolve = pendingDirtyQueries.get(requestId)
  if (resolve) {
    pendingDirtyQueries.delete(requestId)
    resolve(count)
  }
}

function queryDirtyTabCount(window: BrowserWindow): Promise<number> {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2)
    pendingDirtyQueries.set(requestId, resolve)
    window.webContents.send('app:query-dirty', requestId)
    setTimeout(() => {
      if (pendingDirtyQueries.has(requestId)) {
        pendingDirtyQueries.delete(requestId)
        resolve(0)
      }
    }, 800)
  })
}

export function setupAppLifecycle(createContent: () => Promise<void>): void {
  app.whenReady().then(async () => {
    await createContent()
    app.on('activate', () => {
      // macOS: re-create window when dock icon is clicked.
      if (BrowserWindow.getAllWindows().length === 0) void createContent()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
