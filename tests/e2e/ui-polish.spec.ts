import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

let electronApp: ElectronApplication | null = null
let projectDir = ''
let userDataDir = ''

async function launch(args: string[]): Promise<Page> {
  electronApp = await _electron.launch({
    args: [join(here, '../../out/main/index.js'), ...args],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: userDataDir,
    },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(900)
  return window
}

async function dismissWelcome(window: Page): Promise<void> {
  const skip = window.getByTestId('welcome-skip')
  if (await skip.isVisible().catch(() => false)) await skip.click()
}

test.beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'openleaf-polish-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'openleaf-polish-ud-'))
  cpSync(join(here, '../fixtures/project'), projectDir, { recursive: true })
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('starts on the dashboard even when a project was open last time', async () => {
  const first = await launch([projectDir])
  await expect(first.getByTestId('toolbar-title')).toBeVisible({ timeout: 15000 })
  // main.tex opens automatically.
  await expect(first.getByTestId('editor-container')).toContainText('Hello, OpenLeaf!', {
    timeout: 15000,
  })
  await electronApp!.close()
  electronApp = null

  const second = await launch([])
  await expect(second.getByTestId('dashboard')).toBeVisible({ timeout: 15000 })
  await expect(second.getByTestId('app-logo').first()).toBeVisible()
  await expect(second.getByTestId('toolbar-title')).toHaveCount(0)
  await dismissWelcome(second)
})

test('closing the window and re-activating starts on the dashboard', async () => {
  const first = await launch([projectDir])
  await expect(first.getByTestId('toolbar-title')).toBeVisible({ timeout: 15000 })

  const nextWindow = electronApp!.waitForEvent('window')
  await electronApp!.evaluate(async ({ BrowserWindow, app }) => {
    BrowserWindow.getAllWindows()[0]?.close()
    await new Promise((resolve) => setTimeout(resolve, 600))
    app.emit('activate')
  })
  const second = await nextWindow
  await second.waitForLoadState('domcontentloaded')
  await expect(second.getByTestId('dashboard')).toBeVisible({ timeout: 15000 })
  await expect(second.getByTestId('toolbar-title')).toHaveCount(0)
  await dismissWelcome(second)
})

test('a relative "." argument (electron-vite dev entry) does not open a project', async () => {
  const window = await launch(['.'])
  await expect(window.getByTestId('dashboard')).toBeVisible({ timeout: 15000 })
  await expect(window.getByTestId('toolbar-title')).toHaveCount(0)
  await dismissWelcome(window)
})

test('sidebar rail, visual mode, formatting bar and Overview work', async () => {
  const window = await launch([projectDir])
  await expect(window.getByTestId('format-toolbar')).toBeVisible()
  // main.tex is opened automatically on project open.
  await expect(window.getByTestId('editor-container')).toContainText('Hello, OpenLeaf!', {
    timeout: 15000,
  })

  // Visual mode must repaint immediately after the toggle.
  await expect(window.locator('.openleaf-chip')).toHaveCount(0)
  await window.getByTestId('mode-visual').click()
  await expect(window.locator('.openleaf-chip').first()).toBeVisible({ timeout: 5000 })
  await window.getByTestId('mode-source').click()

  // Clicking the active rail item again collapses the body; the rail stays.
  await window.getByTestId('sidebar-tab-files').click()
  await expect(window.getByTestId('sidebar-rail')).toBeVisible()
  await expect(window.getByTestId('file-tree')).toHaveCount(0)
  await window.getByTestId('sidebar-tab-files').click()
  await expect(window.getByTestId('file-tree')).toBeVisible()

  // Overview saves dirty buffers before returning to the dashboard.
  const marker = `saved-by-overview-${Date.now()}`
  await window.getByTestId('editor-container').click()
  await window.keyboard.press('Control+End')
  await window.keyboard.press('Enter')
  await window.keyboard.type(`% ${marker}`)
  await window.waitForTimeout(300)
  await window.getByTestId('home-button').click()
  await expect(window.getByTestId('dashboard')).toBeVisible({ timeout: 15000 })
  expect(readFileSync(join(projectDir, 'main.tex'), 'utf8')).toContain(marker)
})

test('opening the same file repeatedly never duplicates its tab', async () => {
  const window = await launch([projectDir])
  const file = window.getByTestId('tree-file-main.tex')
  await expect(file).toBeVisible({ timeout: 15000 })
  for (let index = 0; index < 4; index++) await file.click()
  await expect(window.locator('[data-testid="tab-main.tex"]')).toHaveCount(1)
})

test('switching projects never shows the previous project main.tex', async () => {
  const otherProject = mkdtempSync(join(tmpdir(), 'openleaf-polish-b-'))
  cpSync(join(here, '../fixtures/project'), otherProject, { recursive: true })
  writeFileSync(
    join(otherProject, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nPROJECT-B-ONLY\n\\end{document}\n'
  )

  const window = await launch([projectDir])
  const editor = window.getByTestId('editor-container')
  await expect(editor).toContainText('Hello, OpenLeaf!', { timeout: 15000 })

  await window.evaluate(async (path) => {
    const bridge = (
      window as unknown as {
        openleaf: { invoke: (channel: string, input?: unknown) => Promise<unknown> }
      }
    ).openleaf
    await bridge.invoke('project:open', { path })
  }, otherProject)

  await expect(editor).toContainText('PROJECT-B-ONLY', { timeout: 15000 })
  await expect(editor).not.toContainText('Hello, OpenLeaf!')
  await expect(window.getByTestId('tabs-bar')).toContainText('main.tex')
  await expect(window.getByTestId('tabs-bar').locator('text=related.tex')).toHaveCount(0)
})

test('clicking a reference jumps to its line in references.bib', async () => {
  writeFileSync(
    join(projectDir, 'references.bib'),
    [
      '% header',
      '@article{first,',
      '  title = {One},',
      '}',
      '',
      '@book{second,',
      '  title = {Two},',
      '}',
    ].join('\n')
  )
  const window = await launch([projectDir])
  await window.getByTestId('sidebar-tab-references').click()
  await window.getByTestId('bib-entry-second').click()
  await expect(window.getByTestId('status-cursor')).toContainText('Ln 6', { timeout: 10000 })
})

test('adding the first bibliography entry creates references.bib', async () => {
  const window = await launch([projectDir])
  await window.getByTestId('sidebar-tab-references').click()
  await window.getByRole('button', { name: 'Add', exact: true }).click()
  await window.getByRole('button', { name: 'Manual', exact: true }).click()
  await window.getByLabel('Citation key').fill('testref')
  await window.getByLabel('Author').fill('Doe, Jane')
  await window.getByLabel('Title').fill('A test entry')
  await window.getByLabel('Year').fill('2026')
  await window.getByRole('button', { name: 'Add entry', exact: true }).click()
  // The key confirmation prompt appears.
  await expect(window.getByTestId('prompt-confirm')).toBeVisible({ timeout: 5000 })
  await window.getByTestId('prompt-confirm').click()

  await expect
    .poll(() => {
      try {
        return readFileSync(join(projectDir, 'references.bib'), 'utf8')
      } catch {
        return ''
      }
    })
    .toContain('@article{testref')
})

test('built-in templates are found when launched from "/" (Finder / packaged app)', async () => {
  electronApp = await _electron.launch({
    cwd: '/',
    args: [join(here, '../../out/main/index.js')],
    env: { ...process.env, OPENLEAF_SKIP_CLOSE_PROMPT: '1', OPENLEAF_USER_DATA_DIR: userDataDir },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  const ids = await window.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        openleaf: {
          invoke: (c: string, i: unknown) => Promise<{ ok: boolean; data?: Array<{ id: string }> }>
        }
      }
    ).openleaf
    const result = await api.invoke('templates:list', undefined)
    return result.ok ? (result.data ?? []).map((template) => template.id) : []
  })
  expect(ids).toEqual(expect.arrayContaining(['article', 'report-thesis', 'sample-project']))
})
