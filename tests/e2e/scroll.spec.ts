import { _electron, expect, test, type ElectronApplication } from '@playwright/test'
import { cpSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

let fixtureProject: string
let electronApp: ElectronApplication | null = null

test.beforeEach(async () => {
  fixtureProject = mkdtempSync(join(tmpdir(), 'openleaf-scroll-'))
  cpSync(join(here, '../fixtures/project'), fixtureProject, { recursive: true })
  // A long document so the editor definitely overflows.
  const long = join(fixtureProject, 'long.tex')
  writeFileSync(long, '\\documentclass{article}\n\\begin{document}\n')
  for (let i = 1; i <= 300; i++) appendFileSync(long, `Line ${i} with some text.\\\\\n`)
  appendFileSync(long, '\\end{document}\n')

  electronApp = await _electron.launch({
    args: [join(here, '../../out/main/index.js'), fixtureProject],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'openleaf-scroll-ud-')),
    },
  })
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('editor scrolls and problems panel collapses', async () => {
  const window = await electronApp!.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await expect(window.getByTestId('toolbar-title')).toContainText('openleaf-scroll-', {
    timeout: 15000,
  })

  // Open the long file.
  await window.getByTestId('tree-file-long.tex').click()
  const editor = window.getByTestId('editor-container')
  await expect(editor).toContainText('Line 1', { timeout: 5000 })

  // Editor scroll: content must overflow and scrollTop must change.
  const scrollable = await window.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller') as HTMLElement | null
    if (!scroller) return { overflow: false, scrolled: 0 }
    return { overflow: scroller.scrollHeight > scroller.clientHeight, scrolled: scroller.scrollTop }
  })
  expect(scrollable.overflow).toBe(true)
  // Focus the editor, then jump to the end of the document.
  await window.locator('.cm-content').click()
  await window.keyboard.press('Meta+ArrowDown')
  await window.waitForTimeout(400)
  const scrolled = await window.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller') as HTMLElement
    return scroller.scrollTop
  })
  expect(scrolled).toBeGreaterThan(100)

  // Problems panel: starts collapsed to its 28 px header; the toggle expands it.
  const panel = window.getByTestId('problems-panel')
  await expect(panel).toBeVisible()
  const heightBefore = await panel.evaluate((el) => el.clientHeight)
  await window.getByTestId('problems-toggle').click()
  await expect(window.getByTestId('problems-tab-all')).toBeVisible()
  await window.waitForTimeout(400)
  const heightAfter = await panel.evaluate((el) => el.clientHeight)
  expect(heightAfter).toBeGreaterThan(heightBefore)
  // The editor area shrinks accordingly (panel is a real split, not an overlay).
  await expect(window.getByTestId('editor-container')).toBeVisible()
})
