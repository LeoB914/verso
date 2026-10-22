import { _electron } from '@playwright/test'
import { mkdtempSync, cpSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Capture main-window screenshots in light and dark mode.
 * Usage: node scripts/screenshot.mjs [outputDir] (default: docs/screenshots).
 * The app always runs with a throw-away userData dir, so the developer's real
 * profile and settings are never touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] ? resolve(process.argv[2]) : join(here, '../docs/screenshots')
mkdirSync(outDir, { recursive: true })

// The sample project, in a folder with a readable name (it is the window title).
const fixture = join(mkdtempSync(join(tmpdir(), 'openleaf-shot-')), 'Welcome to Verso')
const userDataDir = mkdtempSync(join(tmpdir(), 'openleaf-shot-ud-'))
cpSync(join(here, '../resources/sample-project'), fixture, { recursive: true })

const app = await _electron.launch({
  args: [join(here, '../out/main/index.js'), fixture],
  env: {
    ...process.env,
    OPENLEAF_SKIP_CLOSE_PROMPT: '1',
    OPENLEAF_USER_DATA_DIR: userDataDir,
  },
})
const window = await app.firstWindow()
await window.waitForLoadState('domcontentloaded')
await window.waitForTimeout(1500)

// Open main.tex and compile it so the PDF pane shows the result.
const fileButton = window.getByTestId('tree-file-main.tex')
if (await fileButton.isVisible()) await fileButton.click()
await window.getByTestId('compile-button').click()
await window
  .getByTestId('pdf-pages')
  .waitFor({ timeout: 120_000 })
  .catch(() => console.warn('No PDF (TeX missing?) — screenshots show the editor only.'))
await window.waitForTimeout(2500)

await window.screenshot({ path: join(outDir, 'main-light.png') })

// Switch to dark theme via settings IPC; the renderer broadcasts app:theme
// and sets data-theme on <html>. Wait for the attribute + a repaint frame.
await window.evaluate(async () => {
  await window.openleaf.invoke('settings:set', { patch: { appTheme: 'dark' } })
})
await window.waitForFunction(() => document.documentElement.dataset.theme === 'dark', {
  timeout: 5000,
})
await window.waitForTimeout(300)
await window.screenshot({ path: join(outDir, 'main-dark.png') })

await app.close()
console.log(`screenshots written to ${outDir}`)
process.exit(0)
