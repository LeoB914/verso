import { vi } from 'vitest'

/**
 * Shared Electron mock for unit tests. Unit tests must never require the
 * Electron binary: any src/main module that imports `electron` transitively
 * gets these lightweight stubs instead of the real module.
 *
 * Tests that need a writable per-test location should pass paths explicitly
 * (e.g. setHistoryBaseDir, PendingChangeStore ctor) instead of relying on
 * app.getPath.
 */
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/openleaf-test-user-data'),
    setPath: vi.fn(),
    getVersion: vi.fn(() => '0.0.0-test'),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    isReady: vi.fn(() => true),
    setAboutPanelOptions: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
    showMessageBox: vi.fn(async () => ({ response: 0 })),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null),
  },
  webContents: {},
  systemPreferences: {
    getAccentColor: vi.fn(() => '#0A84FF'),
  },
  shell: {
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined),
    trashItem: vi.fn(async () => undefined),
    showItemInFolder: vi.fn(),
  },
  nativeTheme: {
    shouldUseDarkColors: false,
    themeSource: 'system',
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((_v: unknown, secret: string) => Buffer.from(secret)),
    decryptString: vi.fn((_v: unknown, buf: Buffer) => buf.toString('utf8')),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({})),
    setApplicationMenu: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  net: {
    fetch: vi.fn(),
  },
  session: {
    defaultSession: {},
  },
}))
