import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let electronApp: ElectronApplication | null = null
let projectDir = ''

async function launchApp(): Promise<Page> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'openleaf-settings-ud-'))
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
  await expect(window.getByTestId('toolbar-title')).toContainText('openleaf-settings-', {
    timeout: 15000,
  })
  return window
}

interface OlResult<T> {
  ok: boolean
  data: T
}

function invoke<T>(page: Page, channel: string, input: unknown): Promise<OlResult<T>> {
  return page.evaluate(
    ({ channel, input }) => {
      const api = (
        window as unknown as { openleaf: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).openleaf
      return api.invoke(channel, input)
    },
    { channel, input }
  ) as Promise<OlResult<T>>
}

test.beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'openleaf-settings-'))
  cpSync(join(here, '../fixtures/project'), projectDir, { recursive: true })
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('editor theme and line numbers follow the settings live', async () => {
  test.setTimeout(60_000)
  const window = await launchApp()
  await window.getByTestId('tree-file-main.tex').click()
  await expect(window.getByTestId('editor-container')).toContainText('Hello, OpenLeaf!')

  // Dark mode + Dracula: the editor background must be Dracula's #282a36.
  await invoke(window, 'settings:set', { patch: { appTheme: 'dark' } })
  await invoke(window, 'settings:set', { patch: { editorThemeDark: 'dracula' } })
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect
    .poll(
      () =>
        window.locator('.cm-editor').evaluate((el) => {
          return getComputedStyle(el).backgroundColor
        }),
      { timeout: 5000 }
    )
    .toBe('rgb(40, 42, 54)')

  // Line numbers disappear when the setting is off.
  await invoke(window, 'settings:set', { patch: { lineNumbers: false } })
  await expect(window.locator('.cm-lineNumbers')).toHaveCount(0, { timeout: 5000 })
  await invoke(window, 'settings:set', { patch: { lineNumbers: true } })
  await expect(window.locator('.cm-lineNumbers').first()).toBeVisible({ timeout: 5000 })
})

test('soft wrap toggles the lineWrapping extension live', async () => {
  test.setTimeout(60_000)
  const window = await launchApp()
  await window.getByTestId('tree-file-main.tex').click()
  await expect(window.getByTestId('editor-container')).toContainText('Hello, OpenLeaf!')

  const hasWrapClass = (): Promise<boolean> =>
    window.locator('.cm-content').evaluate((el) => el.classList.contains('cm-lineWrapping'))

  await invoke(window, 'settings:set', { patch: { softWrap: false } })
  await expect.poll(hasWrapClass, { timeout: 5000 }).toBe(false)
  await invoke(window, 'settings:set', { patch: { softWrap: true } })
  await expect.poll(hasWrapClass, { timeout: 5000 }).toBe(true)
})
