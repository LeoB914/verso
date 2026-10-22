import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Git branches + commit diffs in the Git panel, user templates in "New Project". */

let electronApp: ElectronApplication | null = null
let projectDir = ''

async function launchApp(args: string[]): Promise<Page> {
  electronApp = await _electron.launch({
    args: [join(here, '../../out/main/index.js'), ...args],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'openleaf-tools-ud-')),
    },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  // Native confirm dialogs cannot be clicked from Playwright: answer "OK".
  await electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never
  })
  return window
}

function invoke(page: Page, channel: string, input: unknown): Promise<unknown> {
  return page.evaluate(
    ({ channel, input }) =>
      (
        globalThis as unknown as {
          openleaf: { invoke: (c: string, i: unknown) => Promise<unknown> }
        }
      ).openleaf.invoke(channel, input),
    { channel, input }
  )
}

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: projectDir, stdio: 'ignore' })
}

test.beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'openleaf-tools-'))
  cpSync(join(here, '../fixtures/project'), projectDir, { recursive: true })
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('git panel lists all branches and shows the diff of a commit file', async () => {
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('add', '-A')
  git('commit', '-q', '-m', 'Initial version')
  git('branch', 'draft')
  writeFileSync(
    join(projectDir, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nREVISED\n\\end{document}\n'
  )
  git('commit', '-q', '-am', 'Revise main')

  const window = await launchApp([projectDir])
  await expect(window.getByTestId('tree-file-main.tex')).toBeVisible({ timeout: 15000 })
  await window.getByTestId('sidebar-tab-git').click()

  const select = window.getByTestId('git-branch-select')
  await expect(select.locator('option')).toHaveText(['draft', 'main', 'New branch…'])

  await window.getByText('Revise main').click()
  await window.getByTestId('git-commit-file-main.tex').click()
  const diff = window.getByTestId('commit-diff')
  await expect(diff).toContainText('REVISED', { timeout: 10_000 })
  await expect(diff).toContainText('Hello, OpenLeaf!')
  await window.keyboard.press('Escape')
  await expect(diff).toHaveCount(0)
})

test('a project saved as template appears in New Project and can be deleted', async () => {
  const window = await launchApp([])
  const skip = window.getByTestId('welcome-skip')
  if (await skip.isVisible().catch(() => false)) await skip.click()

  await invoke(window, 'templates:saveFromProject', { path: projectDir, name: 'My Thesis Layout' })
  await window.getByTestId('new-project').click()
  const dialog = window.getByTestId('new-project-dialog')
  await expect(dialog).toContainText('My Thesis Layout')
  await expect(dialog).toContainText('User template')

  await window.getByTestId('delete-template-my-thesis-layout').click()
  await expect(dialog).not.toContainText('My Thesis Layout')
  await expect(dialog).toContainText('Blank')
})
