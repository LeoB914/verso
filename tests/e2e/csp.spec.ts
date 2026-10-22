import { _electron, expect, test, type ElectronApplication } from '@playwright/test'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let electronApp: ElectronApplication | null = null

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

test('the built app runs under a strict CSP: no violations, inline scripts blocked', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'openleaf-csp-'))
  cpSync(join(here, '../fixtures/project'), projectDir, { recursive: true })
  electronApp = await _electron.launch({
    args: [join(here, '../../out/main/index.js'), projectDir],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'openleaf-csp-ud-')),
    },
  })
  const window = await electronApp.firstWindow()
  const violations: string[] = []
  window.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
  })
  await window.waitForLoadState('domcontentloaded')

  // The normal UI (editor, file tree, toolbar) works without inline scripts.
  await window.getByTestId('tree-file-main.tex').click()
  await expect(window.getByTestId('editor-container')).toContainText('Hello, OpenLeaf!')
  expect(violations).toEqual([])

  // An injected inline script must not run.
  const result = await window.evaluate(async () => {
    const scope = globalThis as unknown as { __inlineRan?: boolean }
    const blocked = new Promise<boolean>((resolve) => {
      document.addEventListener('securitypolicyviolation', () => resolve(true), { once: true })
      setTimeout(() => resolve(false), 1000)
    })
    const script = document.createElement('script')
    script.textContent = 'globalThis.__inlineRan = true'
    document.head.appendChild(script)
    return { ran: scope.__inlineRan === true, violation: await blocked }
  })
  expect(result).toEqual({ ran: false, violation: true })
})
