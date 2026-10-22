import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * E2E smoke tests: launch the built Electron app with a fixture project and
 * verify editor essentials. Skips compiling gracefully when latexmk is not
 * installed.
 */

let fixtureProject: string

test.beforeAll(() => {
  fixtureProject = mkdtempSync(join(tmpdir(), 'openleaf-e2e-'))
  cpSync(join(here, '../fixtures/project'), fixtureProject, { recursive: true })
})

let electronApp: ElectronApplication | null = null
let appWindow: Page | null = null

async function launchApp(projectPath: string): Promise<Page> {
  // Every launch gets its own userData dir so nothing is shared between
  // consecutive app instances (registry, lock file, settings).
  const userDataDir = mkdtempSync(join(tmpdir(), 'openleaf-e2e-ud-'))
  electronApp = await _electron.launch({
    args: [join(here, '../../out/main/index.js'), projectPath],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: userDataDir,
    },
  })
  appWindow = await electronApp.firstWindow()
  await appWindow.waitForLoadState('domcontentloaded')
  return appWindow
}

/** Always tear the app down — even when a test fails mid-way — so the
 * single-instance lock is released for subsequent launches. */
test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
  appWindow = null
})

test('app opens, shows the project and the editor', async () => {
  const window = await launchApp(fixtureProject)

  // Toolbar shows the opened project's name.
  await expect(window.getByTestId('toolbar-title')).toContainText('openleaf-e2e-', {
    timeout: 15000,
  })

  // Open main.tex from the file tree.
  const fileButton = window.getByTestId('tree-file-main.tex')
  await expect(fileButton).toBeVisible({ timeout: 10000 })
  await fileButton.click()

  // Editor shows the document content.
  const editor = window.getByTestId('editor-container')
  await expect(editor).toBeVisible()
  await expect(editor).toContainText('Hello, OpenLeaf!')
})

test('typing \\begin{itemize} + Enter inserts \\end{itemize}', async () => {
  const window = await launchApp(fixtureProject)
  const fileButton = window.getByTestId('tree-file-main.tex')
  await expect(fileButton).toBeVisible({ timeout: 10000 })
  await fileButton.click()
  const editor = window.getByTestId('editor-container')
  await expect(editor).toContainText('Hello, OpenLeaf!')

  // Click at the end of the document and type a new environment.
  await editor.click()
  await window.keyboard.press('Control+End')
  await window.keyboard.press('Enter')
  await window.keyboard.type('\\begin{itemize}', { delay: 40 })
  await window.keyboard.press('Enter')

  await expect(editor).toContainText('\\end{itemize}')
})

test('typing \\ref{ shows labels from other files', async () => {
  const window = await launchApp(fixtureProject)
  const fileButton = window.getByTestId('tree-file-main.tex')
  await expect(fileButton).toBeVisible({ timeout: 10000 })
  await fileButton.click()
  const editor = window.getByTestId('editor-container')
  await expect(editor).toContainText('Hello, OpenLeaf!')
  // Auto-open starts the project index asynchronously; give it a moment so
  // completion is populated when the first keystrokes arrive.
  await window.waitForTimeout(600)

  await editor.click()
  await window.keyboard.press('Control+End')
  await window.keyboard.press('Enter')
  await window.keyboard.type('\\ref{', { delay: 40 })

  // The completion tooltip should offer the label from sections/related.tex.
  const tooltip = window.locator('.cm-tooltip-autocomplete')
  await expect(tooltip).toBeVisible({ timeout: 5000 })
  await expect(tooltip).toContainText('sec:related')
})

test('command palette opens with Mod+K', async () => {
  const window = await launchApp(fixtureProject)
  // Wait for the app to be interactive — a keystroke sent before hydration
  // is simply lost, which used to make this test flaky.
  await expect(window.getByTestId('tree-file-main.tex')).toBeVisible({ timeout: 10000 })
  await window.keyboard.press('Control+k')
  await expect(window.getByTestId('command-palette')).toBeVisible({ timeout: 5000 })
  await window.keyboard.press('Escape')
})

test('compile produces a PDF (skipped without latexmk)', async () => {
  test.skip(!latexmkAvailable(), 'latexmk is not installed on this machine')
  const window = await launchApp(fixtureProject)

  await window.getByTestId('tree-file-main.tex').click()
  await window.getByTestId('compile-button').click()
  await expect(window.getByTestId('pdf-pages')).toBeVisible({ timeout: 30_000 })
  await expect(window.getByTestId('pdf-page-indicator')).toContainText('/ 1')
})

function latexmkAvailable(): boolean {
  try {
    execSync('latexmk --version', { stdio: 'ignore' })
    return true
  } catch {
    return existsSync('/Library/TeX/texbin/latexmk')
  }
}
