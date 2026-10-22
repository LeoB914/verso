import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let electronApp: ElectronApplication | null = null

async function launchApp(): Promise<Page> {
  const projectDir = mkdtempSync(join(tmpdir(), 'openleaf-keys-'))
  cpSync(join(here, '../fixtures/project'), projectDir, { recursive: true })
  electronApp = await _electron.launch({
    args: [join(here, '../../out/main/index.js'), projectDir],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'openleaf-keys-ud-')),
    },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await expect(window.getByTestId('toolbar-title')).toContainText('openleaf-keys-', {
    timeout: 15000,
  })
  return window
}

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('Mod+Shift+C opens the cite picker', async () => {
  const window = await launchApp()
  // Wait until the app is interactive before sending keys.
  await expect(window.getByTestId('tree-file-main.tex')).toBeVisible({ timeout: 10000 })
  await window.keyboard.press('Meta+Shift+C')
  await expect(window.getByTestId('command-palette')).toBeVisible({ timeout: 5000 })
  await expect(window.getByPlaceholder('Insert citation…')).toBeVisible({ timeout: 5000 })
  await window.keyboard.press('Escape')
})

test('Mod+R opens Go to Section (not a window reload)', async () => {
  const window = await launchApp()
  await expect(window.getByTestId('tree-file-main.tex')).toBeVisible({ timeout: 10000 })
  await window.keyboard.press('Meta+r')
  await expect(window.getByTestId('command-palette')).toBeVisible({ timeout: 5000 })
  await window.keyboard.press('Escape')
})

test('Mod+Shift+P opens the command palette, Esc closes it', async () => {
  const window = await launchApp()
  await expect(window.getByTestId('tree-file-main.tex')).toBeVisible({ timeout: 10000 })
  await window.keyboard.press('Meta+Shift+P')
  await expect(window.getByTestId('command-palette')).toBeVisible({ timeout: 5000 })
  await expect(window.getByPlaceholder('Type a command…')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('command-palette')).toHaveCount(0)
})

test('custom keybindings apply live', async () => {
  const window = await launchApp()
  await expect(window.getByTestId('tree-file-main.tex')).toBeVisible({ timeout: 10000 })
  await window.keyboard.press('Meta+,')
  await expect(window.getByTestId('settings-dialog')).toBeVisible({ timeout: 5000 })
  await window.getByRole('button', { name: 'Keyboard', exact: true }).click()
  await window.getByTestId('shortcut-go.commands').click()
  await window.keyboard.press('Meta+Shift+J')
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('settings-dialog')).toHaveCount(0)

  await window.keyboard.press('Meta+Shift+J')
  await expect(window.getByTestId('command-palette')).toBeVisible({ timeout: 5000 })
  await window.keyboard.press('Escape')
})

test('Mod+Shift+F opens project search, Esc closes settings', async () => {
  const window = await launchApp()
  await expect(window.getByTestId('tree-file-main.tex')).toBeVisible({ timeout: 10000 })
  await window.keyboard.press('Meta+Shift+F')
  await expect(window.getByTestId('search-panel')).toBeVisible({ timeout: 5000 })
  await expect(window.getByTestId('search-input')).toBeFocused()

  await window.keyboard.press('Meta+,')
  await expect(window.getByTestId('settings-dialog')).toBeVisible({ timeout: 5000 })
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('settings-dialog')).toHaveCount(0)
})

test('Mod+Shift+H opens and closes the version history', async () => {
  const window = await launchApp()
  await expect(window.getByTestId('tree-file-main.tex')).toBeVisible({ timeout: 10000 })
  await window.keyboard.press('Meta+Shift+H')
  await expect(window.getByTestId('history-view')).toBeVisible({ timeout: 5000 })
  await window.keyboard.press('Meta+Shift+H')
  await expect(window.getByTestId('history-view')).toHaveCount(0)
})
