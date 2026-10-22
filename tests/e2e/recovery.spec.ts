import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let electronApp: ElectronApplication | null = null
let projectDir = ''

async function launchApp(): Promise<Page> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'openleaf-recovery-ud-'))
  electronApp = await _electron.launch({
    args: [join(here, '../../out/main/index.js'), projectDir],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: userDataDir,
    },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await expect(window.getByTestId('toolbar-title')).toContainText('openleaf-recovery-', {
    timeout: 15000,
  })
  return window
}

test.beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'openleaf-recovery-'))
  cpSync(join(here, '../fixtures/project'), projectDir, { recursive: true })
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('dirty buffers survive a renderer crash and can be restored', async () => {
  test.setTimeout(90_000)
  const window = await launchApp()

  // Autosave must not write the buffer, otherwise there is nothing to recover.
  await window.evaluate(async () => {
    const api = (
      window as unknown as {
        openleaf: { invoke: (c: string, i: unknown) => Promise<unknown> }
      }
    ).openleaf
    await api.invoke('settings:set', { patch: { autosaveEnabled: false } })
  })
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await expect(window.getByTestId('toolbar-title')).toContainText('openleaf-recovery-', {
    timeout: 15000,
  })

  await window.getByTestId('tree-file-main.tex').click()
  await expect(window.getByTestId('editor-container')).toContainText('Hello, OpenLeaf!')
  await window.locator('.cm-content').click()
  await window.keyboard.press('Meta+ArrowDown')
  await window.keyboard.type(' RECOVERED-TEXT')

  // Wait for the 5 s recovery interval to mirror the dirty buffer.
  await window.waitForTimeout(6500)

  // Restart the renderer. (A forceful crash would be the harsher variant, but
  // Playwright cannot re-attach to a crashed Electron target; a reload drops
  // the same in-memory buffers, which is exactly what recovery must survive.)
  await electronApp!.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.reload()
  })
  await window.waitForLoadState('domcontentloaded')
  await expect(window.getByTestId('recovery-sheet')).toBeVisible({ timeout: 20_000 })
  await expect(window.getByTestId('recovery-sheet')).toContainText('main.tex')

  // Restore loads the buffer into a dirty tab (nothing written to disk yet).
  await window.getByTestId('recovery-restore-main.tex').click()
  await expect(window.getByTestId('editor-container')).toContainText('RECOVERED-TEXT', {
    timeout: 10_000,
  })
  await expect(window.getByTestId('recovery-sheet')).toHaveCount(0)
})

test('undecided recovery survives another restart; discarding one file keeps the others', async () => {
  test.setTimeout(120_000)
  const window = await launchApp()
  await window.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        openleaf: { invoke: (c: string, i: unknown) => Promise<unknown> }
      }
    ).openleaf
    await api.invoke('settings:set', { patch: { autosaveEnabled: false } })
  })
  for (const [testId, text] of [
    ['tree-file-main.tex', ' MAIN-EDIT'],
    ['tree-file-sections/related.tex', ' RELATED-EDIT'],
  ]) {
    await window.getByTestId(testId).click()
    await window.locator('.cm-content').click()
    await window.keyboard.press('Meta+ArrowDown')
    await window.keyboard.type(text)
  }
  await window.waitForTimeout(6500)

  const reload = async (): Promise<void> => {
    await electronApp!.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.reload()
    })
    await window.waitForLoadState('domcontentloaded')
    await expect(window.getByTestId('recovery-sheet')).toBeVisible({ timeout: 20_000 })
  }
  await reload()
  // Leave the sheet open longer than the 5 s mirror interval, then restart:
  // the recovery file must still be there.
  await window.waitForTimeout(6500)
  await reload()
  await expect(window.getByTestId('recovery-sheet')).toContainText('main.tex')
  await expect(window.getByTestId('recovery-sheet')).toContainText('sections/related.tex')

  // Discarding main.tex keeps related.tex available.
  await window.getByTestId('recovery-discard').first().click()
  await expect(window.getByTestId('recovery-sheet')).toContainText('sections/related.tex')
  await window.getByTestId('recovery-restore-sections/related.tex').click()
  await expect(window.getByTestId('editor-container')).toContainText('RELATED-EDIT', {
    timeout: 10_000,
  })
  await expect(window.getByTestId('recovery-sheet')).toHaveCount(0)
})
