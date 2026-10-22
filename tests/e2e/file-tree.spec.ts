import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let electronApp: ElectronApplication | null = null
let projectDir = ''

async function launchApp(
  userDataDir?: string,
  openProject = true
): Promise<{ window: Page; userData: string }> {
  const dataDir = userDataDir ?? mkdtempSync(join(tmpdir(), 'openleaf-tree-ud-'))
  electronApp = await _electron.launch({
    args: openProject
      ? [join(here, '../../out/main/index.js'), projectDir]
      : [join(here, '../../out/main/index.js')],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: dataDir,
    },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  if (openProject) {
    await expect(window.getByTestId('toolbar-title')).toContainText('openleaf-tree-', {
      timeout: 15000,
    })
  }
  return { window, userData: dataDir }
}

test.beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'openleaf-tree-'))
  cpSync(join(here, '../fixtures/project'), projectDir, { recursive: true })
  mkdirSync(join(projectDir, 'sections', 'nested'), { recursive: true })
  writeFileSync(join(projectDir, 'sections', 'nested', 'deep.tex'), 'Deep\n')
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('folders expand and collapse in the sidebar', async () => {
  const { window } = await launchApp()
  // Nested folder starts collapsed.
  await expect(window.getByTestId('tree-file-sections/nested/deep.tex')).toHaveCount(0)
  await window.getByTestId('tree-file-sections/nested').click()
  await expect(window.getByTestId('tree-file-sections/nested/deep.tex')).toBeVisible()
  await window.getByTestId('tree-file-sections/nested').click()
  await expect(window.getByTestId('tree-file-sections/nested/deep.tex')).toHaveCount(0)
})

test('new file and new folder use the in-app prompt', async () => {
  const { window } = await launchApp()

  await window.getByTitle('New file').click()
  await window.getByTestId('prompt-input').waitFor()
  await window.getByTestId('prompt-input').fill('created.tex')
  await window.getByTestId('prompt-confirm').click()
  await expect(window.getByTestId('tree-file-created.tex')).toBeVisible({ timeout: 5000 })
  expect(existsSync(join(projectDir, 'created.tex'))).toBe(true)

  await window.getByTitle('New folder').click()
  await window.getByTestId('prompt-input').waitFor()
  await window.getByTestId('prompt-input').fill('newdir')
  await window.getByTestId('prompt-confirm').click()
  await expect(window.getByTestId('tree-file-newdir')).toBeVisible({ timeout: 5000 })
  expect(existsSync(join(projectDir, 'newdir'))).toBe(true)

  // Escape cancels without creating anything.
  await window.getByTitle('New file').click()
  await window.getByTestId('prompt-input').waitFor()
  await window.getByTestId('prompt-input').fill('nope.tex')
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('prompt-dialog')).toHaveCount(0)
  expect(existsSync(join(projectDir, 'nope.tex'))).toBe(false)
})

test('the welcome sheet can be dismissed permanently and re-enabled', async () => {
  const { window, userData } = await launchApp()

  // Close the project -> dashboard with the welcome sheet.
  await electronApp!.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      ?.items.flatMap((m) => m.submenu?.items ?? [])
      .find((item) => item.label === 'Close Project')
      ?.click()
  })
  await expect(window.getByTestId('welcome-sheet')).toBeVisible({ timeout: 15000 })
  await expect(window.getByTestId('welcome-dont-show')).toBeChecked()
  await window.getByTestId('welcome-skip').click()
  await expect(window.getByTestId('welcome-sheet')).toHaveCount(0)

  // Relaunch with the same userData: the sheet stays away.
  await electronApp!.close()
  const relaunched = await launchApp(userData, false)
  await expect(relaunched.window.getByTestId('dashboard')).toBeVisible({ timeout: 15000 })
  await expect(relaunched.window.getByTestId('welcome-sheet')).toHaveCount(0)

  // Settings -> General can bring it back.
  await relaunched.window.evaluate(async () => {
    const api = (
      window as unknown as {
        openleaf: { invoke: (channel: string, input: unknown) => Promise<unknown> }
      }
    ).openleaf
    await api.invoke('firstrun:reset', undefined)
  })
  await relaunched.window.reload()
  await relaunched.window.waitForLoadState('domcontentloaded')
  await expect(relaunched.window.getByTestId('welcome-sheet')).toBeVisible({ timeout: 15000 })
})
