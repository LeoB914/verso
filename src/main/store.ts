import Store from 'electron-store'
import { migrateSettings, parseSettings, type AppSettingsData } from '@shared/settings'

export interface RegistryProject {
  path: string
  name: string
  lastOpened: number
  tags: string[]
  /** Optional per-project pane layout (see ProjectUiState in shared/ipc). */
  uiState?: Record<string, unknown>
}

export interface AppStoreSchema {
  lastProjectPath: string | null
  sidebarVisible: boolean
  pdfVisible: boolean
  sidebarSize: number
  pdfSize: number
  pdfWindowBounds: { x: number; y: number; width: number; height: number } | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
  firstRunDone: boolean
  projects: RegistryProject[]
  showHiddenFiles: boolean
  /** Validated app settings (see @shared/settings). */
  appSettings: AppSettingsData
}

let store: Store<AppStoreSchema> | null = null

/** Read the persisted settings, migrate and validate. */
function loadSettings(stored: unknown): AppSettingsData {
  const migrated = migrateSettings((stored ?? {}) as Record<string, unknown>)
  return parseSettings(migrated)
}

export function getAppStore(): Store<AppStoreSchema> {
  if (!store) {
    store = new Store<AppStoreSchema>({
      defaults: {
        lastProjectPath: null,
        sidebarVisible: true,
        pdfVisible: true,
        sidebarSize: 20,
        pdfSize: 45,
        pdfWindowBounds: null,
        windowBounds: null,
        firstRunDone: false,
        projects: [],
        showHiddenFiles: false,
        appSettings: parseSettings({}),
      },
    })
    // Migrate + validate the stored settings once at startup.
    const current = store.get('appSettings')
    const migrated = loadSettings(current)
    if (JSON.stringify(current) !== JSON.stringify(migrated)) {
      store.set('appSettings', migrated)
    }
  }
  return store
}

/** Read the validated settings. */
export function getSettings(): AppSettingsData {
  return getAppStore().get('appSettings')
}

/** Patch settings with a validated subset; returns the new settings. */
export function patchSettings(patch: Record<string, unknown>): AppSettingsData {
  const storeInstance = getAppStore()
  const merged = { ...storeInstance.get('appSettings'), ...patch }
  const validated = parseSettings(merged)
  storeInstance.set('appSettings', validated)
  return validated
}
