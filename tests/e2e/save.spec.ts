import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Saving after the app wrote a file on the user's behalf (B1) and during
 * continuous typing (M5): the editor must pick up main-side writes and its
 * own autosaves must never raise the conflict banner.
 */

let electronApp: ElectronApplication | null = null
let projectDir = ''

async function launchApp(): Promise<Page> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'openleaf-save-ud-'))
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
  await expect(window.getByTestId('toolbar-title')).toContainText('openleaf-save-', {
    timeout: 15000,
  })
  return window
}

interface OlResult<T> {
  ok: boolean
  data: T
}

/** Call a preload API channel from the renderer (typed for tests). */
function invoke<T>(page: Page, channel: string, input: unknown): Promise<OlResult<T>> {
  return page.evaluate(
    ({ channel, input }) => {
      const api = (
        window as unknown as {
          openleaf: { invoke: (c: string, i: unknown) => Promise<unknown> }
        }
      ).openleaf
      return api.invoke(channel, input)
    },
    { channel, input }
  ) as Promise<OlResult<T>>
}

test.beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'openleaf-save-'))
  cpSync(join(here, '../fixtures/project'), projectDir, { recursive: true })
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('typing after an app-side file write reaches disk together with that write', async () => {
  test.setTimeout(60_000)
  const window = await launchApp()

  await window.getByTestId('tree-file-main.tex').click()
  await expect(window.getByTestId('editor-container')).toContainText('Hello, OpenLeaf!')

  // Simulate an app-side write (history restore, replace-all, etc.).
  const content = readFileSync(join(projectDir, 'main.tex'), 'utf8').replace(
    'Hello, OpenLeaf!',
    'Hello from app!'
  )
  const written = await invoke<null>(window, 'files:writeMany', {
    files: [{ relPath: 'main.tex', content }],
  })
  expect(written.ok).toBe(true)

  // The open editor picks up the app's write (no reload of the window).
  await expect(window.getByTestId('editor-container')).toContainText('Hello from app!', {
    timeout: 10_000,
  })

  // Type at the end; autosave must persist the merged content.
  await window.locator('.cm-content').click()
  await window.keyboard.press('Meta+ArrowDown')
  await window.keyboard.type(' USER-TEXT')
  await window.waitForTimeout(4000)

  const disk = readFileSync(join(projectDir, 'main.tex'), 'utf8')
  expect(disk).toContain('Hello from app!')
  expect(disk).toContain('USER-TEXT')

  await expect(window.getByTestId('toast-error')).toHaveCount(0)
  await expect(window.getByTestId('conflict-banner')).toHaveCount(0)
})

test('continuous typing never raises the conflict banner and reaches disk', async () => {
  test.setTimeout(90_000)
  const window = await launchApp()
  await window.getByTestId('tree-file-main.tex').click()
  await expect(window.getByTestId('editor-container')).toContainText('Hello, OpenLeaf!')

  await window.locator('.cm-content').click()
  await window.keyboard.press('Meta+ArrowDown')

  const words = Array.from({ length: 30 }, (_, i) => ` word${i}`).join('')
  await window.keyboard.type(words, { delay: 45 })

  // Give the last autosave a chance to land.
  await window.waitForTimeout(4000)

  await expect(window.getByTestId('conflict-banner')).toHaveCount(0)
  await expect(window.getByTestId('toast-error')).toHaveCount(0)

  // The last autosave can land slightly after the fixed wait on a busy CI
  // machine; poll instead of asserting a snapshot.
  await expect
    .poll(() => readFileSync(join(projectDir, 'main.tex'), 'utf8').includes('word29'), {
      timeout: 15_000,
    })
    .toBe(true)
  const editorText = await window.evaluate(() => {
    return document.querySelector('.cm-content')?.textContent ?? ''
  })
  // The last word is visible in the editor as well.
  expect(editorText).toContain('word29')
})

test('an external change to a clean file reloads it (watcher still reports)', async () => {
  test.setTimeout(60_000)
  const window = await launchApp()
  await window.getByTestId('tree-file-main.tex').click()
  await expect(window.getByTestId('editor-container')).toContainText('Hello, OpenLeaf!')

  // Simulate an external editor writing the file.
  writeFileSync(
    join(projectDir, 'main.tex'),
    readFileSync(join(projectDir, 'main.tex'), 'utf8').replace(
      'Hello, OpenLeaf!',
      'Hello, external!'
    )
  )
  await expect(window.getByTestId('editor-container')).toContainText('Hello, external!', {
    timeout: 10_000,
  })
})

test('restoring the whole project updates open tabs and later saves still work', async () => {
  const window = await launchApp()
  await window.getByTestId('tree-file-main.tex').click()
  const snapshot = await invoke<{ id: string }>(window, 'history:snapshot', {
    reason: 'test',
    label: 'before',
  })
  await window.getByTestId('editor-container').getByText('More prose here.').click()
  await window.keyboard.press('End')
  await window.keyboard.type(' AFTER-SNAPSHOT')
  await expect
    .poll(() => readFileSync(join(projectDir, 'main.tex'), 'utf8'), { timeout: 10_000 })
    .toContain('AFTER-SNAPSHOT')

  await invoke(window, 'history:restoreProject', { snapshotId: snapshot.data.id })
  await expect
    .poll(() => readFileSync(join(projectDir, 'main.tex'), 'utf8'), { timeout: 10_000 })
    .not.toContain('AFTER-SNAPSHOT')
  // The open tab shows the restored text …
  await expect(window.getByTestId('editor-container')).not.toContainText('AFTER-SNAPSHOT', {
    timeout: 10_000,
  })
  // … and typing afterwards is saved on top of it (no "changed on disk" error).
  await window.getByTestId('editor-container').getByText('More prose here.').click()
  await window.keyboard.press('End')
  await window.keyboard.type(' NEXT-EDIT')
  await expect
    .poll(() => readFileSync(join(projectDir, 'main.tex'), 'utf8'), { timeout: 10_000 })
    .toContain('NEXT-EDIT')
  await expect(window.getByText(/File changed on disk/)).toHaveCount(0)
})
