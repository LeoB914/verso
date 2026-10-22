import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let electronApp: ElectronApplication | null = null
let projectDir = ''
let targetDir = ''

async function launchApp(): Promise<Page> {
  // Seed the throw-away profile with a temp default project directory so the
  // test never creates folders in the user's Documents.
  const userData = mkdtempSync(join(tmpdir(), 'openleaf-newproj-ud-'))
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ defaultProjectDir: targetDir }))
  electronApp = await _electron.launch({
    args: [join(here, '../../out/main/index.js'), projectDir],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: userData,
    },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(800)
  return window
}

test.beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'openleaf-newproj-'))
  targetDir = mkdtempSync(join(tmpdir(), 'openleaf-newproj-target-'))
  cpSync(join(here, '../fixtures/project'), projectDir, { recursive: true })
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('a new project can be created from a template', async () => {
  test.setTimeout(60_000)
  const window = await launchApp()

  // Close the starting project to reach the dashboard.
  await electronApp!.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      ?.items.flatMap((m) => m.submenu?.items ?? [])
      .find((item) => item.label === 'Close Project')
      ?.click()
  })
  await expect(window.getByTestId('dashboard')).toBeVisible({ timeout: 15000 })
  if (
    await window
      .getByTestId('welcome-sheet')
      .isVisible()
      .catch(() => false)
  ) {
    await window.getByTestId('welcome-skip').click()
  }

  await window.getByTestId('new-project').click()
  await expect(window.getByTestId('new-project-dialog')).toBeVisible()
  const blankCard = window
    .locator('[data-testid="new-project-dialog"] button')
    .filter({ hasText: 'Blank' })
    .first()
  await blankCard.click()
  await expect(window.getByTestId('prompt-input')).toBeVisible({ timeout: 5000 })
  await expect(window.getByTestId('prompt-input')).toHaveValue('Blank Project')
  await window.getByTestId('prompt-confirm').click()

  // The project opens with a detected main file.
  await expect(window.getByTestId('toolbar-title')).toContainText('Blank Project', {
    timeout: 20000,
  })
  await expect(window.getByTestId('file-tree')).toBeVisible()
  await expect(window.getByTestId('tree-file-main.tex')).toBeVisible()
})

test('creating a project with an existing name reports an error', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'openleaf-newproj-ud-'))
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ defaultProjectDir: targetDir }))

  const launch = async (withProject: boolean): Promise<Page> => {
    electronApp = await _electron.launch({
      args: withProject
        ? [join(here, '../../out/main/index.js'), projectDir]
        : [join(here, '../../out/main/index.js')],
      env: {
        ...process.env,
        OPENLEAF_SKIP_CLOSE_PROMPT: '1',
        OPENLEAF_USER_DATA_DIR: userData,
      },
    })
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    return page
  }

  const createProject = async (window: Page, name: string): Promise<void> => {
    await window.getByTestId('new-project').click()
    const card = window
      .locator('[data-testid="new-project-dialog"] button')
      .filter({ hasText: 'Blank' })
      .first()
    await card.click()
    await window.getByTestId('prompt-input').waitFor()
    await window.getByTestId('prompt-input').fill(name)
    await window.getByTestId('prompt-confirm').click()
  }

  // First instance: create the project.
  const first = await launch(true)
  await first.waitForSelector('[data-testid="dashboard"], [data-testid="toolbar-title"]')
  await first.evaluate(async () => {
    const api = (
      window as unknown as {
        openleaf: { invoke: (channel: string, input: unknown) => Promise<unknown> }
      }
    ).openleaf
    await api.invoke('project:close', undefined)
  })
  await first.reload()
  await first.waitForLoadState('domcontentloaded')
  await expect(first.getByTestId('dashboard')).toBeVisible({ timeout: 15000 })
  if (
    await first
      .getByTestId('welcome-sheet')
      .isVisible()
      .catch(() => false)
  ) {
    await first.getByTestId('welcome-skip').click()
  }
  await createProject(first, 'Duplicate')
  await expect(first.getByTestId('toolbar-title')).toContainText('Duplicate', { timeout: 20000 })
  expect(existsSync(join(targetDir, 'Duplicate', 'main.tex'))).toBe(true)
  await electronApp!.close()

  // Second instance: the same name is rejected with a toast.
  const second = await launch(false)
  await expect(second.getByTestId('dashboard')).toBeVisible({ timeout: 15000 })
  if (
    await second
      .getByTestId('welcome-sheet')
      .isVisible()
      .catch(() => false)
  ) {
    await second.getByTestId('welcome-skip').click()
  }
  await createProject(second, 'Duplicate')
  await expect(second.getByTestId('toast-error')).toContainText('already exists', {
    timeout: 10000,
  })
})
