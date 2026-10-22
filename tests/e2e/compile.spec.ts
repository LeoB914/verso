import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Real-TeX E2E: these tests drive the full compile → PDF → SyncTeX loop
 * against the machine's TeX installation (MacTeX). They are skipped when
 * latexmk is missing — never mock TeX.
 */
test.skip(!latexmkAvailable(), 'latexmk is not installed on this machine')

let electronApp: ElectronApplication | null = null

function latexmkAvailable(): boolean {
  try {
    execSync('latexmk -v', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

/** Lines of the sample main.tex. Exported so tests know exact line numbers. */
function mainTexLines(): string[] {
  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{lmodern}',
    '\\usepackage{graphicx}',
    '\\usepackage{amsmath}',
    '\\usepackage{booktabs}',
    '\\usepackage[backend=biber,style=authoryear]{biblatex}',
    '\\usepackage{hyperref}',
    '\\addbibresource{references.bib}',
    '\\title{Welcome to OpenLeaf}',
    '\\author{Your Name}',
    '\\date{\\today}',
    '\\begin{document}',
    '\\maketitle',
    '\\section{Introduction}',
    'Some prose with a citation \\cite{knuth1984} and math $x^2 + y_1$.',
    '\\begin{equation}',
    '  \\label{eq:cauchy}',
    '  \\int_{-\\infty}^{\\infty} e^{-x^2}\\,\\mathrm{d}x = \\sqrt{\\pi}',
    '\\end{equation}',
    '\\begin{table}[ht]',
    '  \\centering',
    '  \\caption{Sample results}',
    '  \\label{tab:results}',
    '  \\begin{tabular}{lr}',
    '    \\toprule',
    '    Condition & Mean \\\\',
    '    \\midrule',
    '    Control & 3.4 \\\\',
    '    Treatment & 5.1 \\\\',
    '    \\bottomrule',
    '  \\end{tabular}',
    '\\end{table}',
    '\\begin{figure}[ht]',
    '  \\centering',
    '  \\includegraphics[width=2cm]{figures/example.png}',
    '  \\caption{An example figure}',
    '  \\label{fig:example}',
    '\\end{figure}',
    'See Figure~\\ref{fig:example} and Table~\\ref{tab:results}.',
    '\\newpage',
    '\\section{Limits}',
    '\\input{sections/limits}',
    '\\printbibliography',
    '\\end{document}',
  ]
}

function createSampleProject(): string {
  const project = mkdtempSync(join(tmpdir(), 'openleaf-compile-'))
  const lines = mainTexLines()
  writeFileSync(join(project, 'main.tex'), lines.join('\n') + '\n')
  mkdirSync(join(project, 'sections'), { recursive: true })
  writeFileSync(
    join(project, 'sections', 'limits.tex'),
    [
      '% Included from main.tex',
      'We prove the squeeze theorem for bounded monotone sequences.',
      'Let $a_n$ be monotone and bounded, then $a_n$ converges.',
    ].join('\n') + '\n'
  )
  mkdirSync(join(project, 'figures'), { recursive: true })
  writeFileSync(join(project, 'figures', 'example.png'), SAMPLE_PNG)
  writeFileSync(
    join(project, 'references.bib'),
    [
      '@book{knuth1984,',
      '  title = {The TeXbook},',
      '  author = {Donald E. Knuth},',
      '  year = {1984},',
      '  publisher = {Addison-Wesley},',
      '}',
    ].join('\n') + '\n'
  )
  return project
}

async function launchApp(projectPath: string, titleMatch = 'openleaf-compile-'): Promise<Page> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'openleaf-compile-ud-'))
  electronApp = await _electron.launch({
    args: [join(here, '../../out/main/index.js'), projectPath],
    env: {
      ...process.env,
      OPENLEAF_SKIP_CLOSE_PROMPT: '1',
      OPENLEAF_USER_DATA_DIR: userDataDir,
    },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await expect(window.getByTestId('toolbar-title')).toContainText(titleMatch, {
    timeout: 15000,
  })
  return window
}

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  electronApp = null
})

async function compileAndAwaitPdf(window: Page): Promise<void> {
  await window.getByTestId('tree-file-main.tex').click()
  await window.getByTestId('compile-button').click()
  await expect(window.getByTestId('compile-status')).toContainText('Compiled in', {
    timeout: 120_000,
  })
  await expect(window.getByTestId('pdf-pages').locator('[data-page] canvas').first()).toBeVisible({
    timeout: 30_000,
  })
}

/** pid of the pdflatex process working inside projectDir, if any. */
function pdflatexPidFor(projectDir: string): string | null {
  let realDir = projectDir
  try {
    // macOS reports /private/var/... while Node's tmpdir() yields /var/...
    realDir = realpathSync(projectDir)
  } catch {
    // keep projectDir
  }
  try {
    const pids = execSync('pgrep -x pdflatex || true').toString().trim()
    for (const pid of pids.split('\n').filter(Boolean)) {
      try {
        const out = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null || true`).toString()
        const cwd = out
          .split('\n')
          .find((l) => l.startsWith('n/'))
          ?.slice(1)
        if (cwd === realDir || cwd?.startsWith(realDir + '/')) return pid
      } catch {
        // process may have exited between pgrep and lsof
      }
    }
  } catch {
    // pgrep unavailable
  }
  return null
}

function waitForCompileToStart(window: Page): Promise<void> {
  return expect(window.getByTestId('compile-status')).toContainText('Compiling', {
    timeout: 20_000,
  }) as unknown as Promise<void>
}

test('compiles the full sample project and shows the PDF', async () => {
  test.setTimeout(180_000)
  const window = await launchApp(createSampleProject())
  await compileAndAwaitPdf(window)
  // Page count > 0.
  await expect(window.getByTestId('pdf-page-indicator')).toContainText('/ ')
  const indicator = await window.getByTestId('pdf-page-indicator').textContent()
  expect(indicator).toMatch(/\/ [1-9]/)
  // Status shows success with a duration.
  await expect(window.getByTestId('compile-status')).toContainText(/Compiled in \d+\.\d s/)
})

test('cite picker inserts the citation at the cursor', async () => {
  test.setTimeout(180_000)
  const window = await launchApp(createSampleProject())
  await compileAndAwaitPdf(window)

  // Put the cursor at the end of the "See Figure…" line (line 41, no citation).
  await window.locator('.cm-content').click()
  await window.keyboard.press('Meta+ArrowUp')
  await window.keyboard.press('Meta+ArrowRight')
  // Navigate to line 41, self-correcting against the status bar (the first
  // keystroke after focusing can be swallowed).
  for (let i = 0; i < 60; i++) {
    const cursor = await window.getByTestId('status-cursor').textContent()
    const line = Number(/Ln (\d+)/.exec(cursor ?? '')?.[1] ?? 1)
    if (line === 41) break
    await window.keyboard.press(line < 41 ? 'ArrowDown' : 'ArrowUp')
  }
  await window.keyboard.press('Meta+ArrowRight')

  // Open the References panel and insert the knuth1984 entry.
  await window.getByTestId('sidebar-tab-references').click()
  const insert = window.getByTestId('insert-citation-knuth1984')
  await expect(insert).toBeVisible({ timeout: 10_000 })
  await insert.click()

  // The citation command appears at the cursor (end of that line), not at
  // the end of the file and not as a TODO comment.
  const editor = window.getByTestId('editor-container')
  await expect(editor).toContainText('Table~\\ref{tab:results}.\\cite{knuth1984}')
  await expect(editor).not.toContainText('TODO insert')
})

test('undefined command: problem row with file+line, jump, and lint squiggle', async () => {
  test.setTimeout(180_000)
  const lines = mainTexLines()
  // Insert the error before \end{document} so pdflatex actually processes it.
  const endIdx = lines.indexOf('\\end{document}')
  lines.splice(endIdx, 0, '\\undefinedcommand')
  const errorLine = endIdx + 1

  const project = createSampleProject()
  // Rewrite main.tex with the error on a known line.
  writeFileSync(join(project, 'main.tex'), lines.join('\n') + '\n')

  const window = await launchApp(project)
  await window.getByTestId('tree-file-main.tex').click()
  await window.getByTestId('compile-button').click()
  await expect(window.getByTestId('compile-status')).toContainText('Compilation failed', {
    timeout: 120_000,
  })

  // The problems panel auto-expands and shows the error with file and line.
  const panel = window.getByTestId('problems-panel')
  await expect(panel).toContainText('Undefined control sequence', { timeout: 15_000 })
  await expect(panel).toContainText(`main.tex:${errorLine}`)

  // Clicking the problem moves the cursor to that line.
  await panel.locator('button', { hasText: 'Undefined control sequence' }).first().click()
  await expect(window.getByTestId('status-cursor')).toContainText(`Ln ${errorLine}`)

  // The editor shows a lint squiggle on the offending line.
  const squiggle = window.locator('.cm-lintRange-error').first()
  await expect(squiggle).toBeVisible({ timeout: 10_000 })
  // Hovering the squiggle explains the error (the full message + fix help).
  // Focus the window explicitly: a second Electron instance from a parallel
  // test used to steal focus and suppress the hover tooltip.
  await window.bringToFront()
  const box = await squiggle.boundingBox()
  expect(box).not.toBeNull()
  await window.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await window.mouse.move(box!.x + box!.width / 2 + 1, box!.y + box!.height / 2)
  await expect(window.locator('.cm-tooltip-lint')).toContainText('Undefined control sequence', {
    timeout: 5000,
  })
})

test('missing package: help text and tlmgr install hint', async () => {
  test.setTimeout(180_000)
  const lines = mainTexLines()
  lines.splice(9, 0, '\\usepackage{doesnotexist}')

  const project = createSampleProject()
  writeFileSync(join(project, 'main.tex'), lines.join('\n') + '\n')

  const window = await launchApp(project)
  await window.getByTestId('tree-file-main.tex').click()
  await window.getByTestId('compile-button').click()
  await expect(window.getByTestId('compile-status')).toContainText('Compilation failed', {
    timeout: 120_000,
  })

  const panel = window.getByTestId('problems-panel')
  await expect(panel).toContainText("doesnotexist.sty' not found", { timeout: 30_000 })

  // Expand the entry's help section: it offers the tlmgr install command.
  const row = panel.locator('button', { hasText: 'doesnotexist' }).first()
  await row.locator('[role="button"]').click()
  await expect(panel).toContainText('tlmgr install doesnotexist')
})

test('SyncTeX forward and backward across an \\input file', async () => {
  test.setTimeout(240_000)
  const window = await launchApp(createSampleProject())
  await compileAndAwaitPdf(window)

  // Open the included file and put the cursor on its second line.
  await window.getByTestId('tree-file-sections/limits.tex').click()
  const editor = window.getByTestId('editor-container')
  await expect(editor).toContainText('squeeze theorem')
  await window.locator('.cm-content').click()
  await window.keyboard.press('Meta+ArrowUp')
  await window.keyboard.press('ArrowDown')

  // Forward: PDF scrolls to page 2 and a highlight box appears.
  await window.keyboard.press('Meta+Alt+ArrowRight')
  await expect(window.locator('[data-page] .border-2').first()).toBeVisible({ timeout: 15_000 })
  const scrolled = await window.evaluate(() => {
    const pages = document.querySelector('[data-testid="pdf-pages"]')
    const scroller = pages?.parentElement
    return scroller instanceof HTMLElement ? scroller.scrollTop : -1
  })
  expect(scrolled).toBeGreaterThan(0)

  // Backward: click the exact PDF point SyncTeX reported for source line 2.
  // This catches a flipped/offset coordinate mapping (PDF points are top-left).
  const viewResult = await window.evaluate(async () => {
    const api = (
      window as unknown as {
        openleaf: { invoke: (channel: string, input: unknown) => Promise<unknown> }
      }
    ).openleaf
    return api.invoke('synctex:forward', {
      relPath: 'sections/limits.tex',
      line: 2,
      column: 0,
    })
  })
  const view = (
    viewResult as {
      ok: boolean
      data: { page: number; x: number; y: number; width: number; height: number } | null
    }
  ).data
  expect(view).not.toBeNull()
  const pageElement = window.locator(`[data-page="${view!.page}"]`)
  await pageElement.scrollIntoViewIfNeeded()
  const scale = Number(await pageElement.getAttribute('data-scale'))
  const pageBox = await pageElement.boundingBox()
  expect(pageBox).not.toBeNull()
  await window.mouse.click(
    pageBox!.x + view!.x * scale + Math.max(2, view!.width / 2),
    pageBox!.y + view!.y * scale + Math.max(2, view!.height / 2)
  )

  // The correct file opens with the cursor on the right line (±1).
  await expect(window.getByTestId('editor-container')).toContainText('squeeze theorem', {
    timeout: 15_000,
  })
  const cursor = await window.getByTestId('status-cursor').textContent()
  const line = Number(/Ln (\d+)/.exec(cursor ?? '')?.[1])
  expect(Math.abs(line - 2)).toBeLessThanOrEqual(1)
})

test('auto-compile recompiles once after the idle delay and keeps the PDF scroll', async () => {
  test.setTimeout(180_000)
  const window = await launchApp(createSampleProject())
  await compileAndAwaitPdf(window)

  // Scroll the PDF away from the top.
  await window.evaluate(() => {
    const scroller = document.querySelector('[data-testid="pdf-pages"]')?.parentElement
    if (scroller instanceof HTMLElement) scroller.scrollTop = scroller.scrollHeight
  })
  const pageBefore = await window.evaluate(() => {
    const scroller = document.querySelector('[data-testid="pdf-pages"]')?.parentElement
    if (!(scroller instanceof HTMLElement)) return -1
    let current = 0
    for (const page of scroller.querySelectorAll<HTMLElement>('[data-page]')) {
      if (page.offsetTop <= scroller.scrollTop + scroller.clientHeight / 3) {
        current = Number(page.dataset.page)
      } else break
    }
    return current
  })
  expect(pageBefore).toBeGreaterThan(0)

  await window.getByTestId('auto-compile-toggle').click()
  await window.getByTestId('tree-file-main.tex').click()
  await window.locator('.cm-content').click()
  await window.keyboard.press('Meta+ArrowDown')
  await window.keyboard.type('Extra words for auto-compile.')

  // Auto-compile kicks in after the 1.5 s idle delay.
  await waitForCompileToStart(window)
  await expect(window.getByTestId('compile-status')).toContainText('Compiled in', {
    timeout: 60_000,
  })

  // Let the PDF reload and render settle, then check the scroll anchor:
  // the same page must still be at the top of the viewport.
  await window.waitForTimeout(2000)
  const pageAfter = await window.evaluate(() => {
    const scroller = document.querySelector('[data-testid="pdf-pages"]')?.parentElement
    if (!(scroller instanceof HTMLElement)) return -1
    let current = 0
    for (const page of scroller.querySelectorAll<HTMLElement>('[data-page]')) {
      if (page.offsetTop <= scroller.scrollTop + scroller.clientHeight / 3) {
        current = Number(page.dataset.page)
      } else break
    }
    return current
  })
  expect(pageAfter).toBe(pageBefore)
})

test('XeLaTeX and LuaLaTeX both compile the sample project', async () => {
  test.setTimeout(300_000)
  const window = await launchApp(createSampleProject())

  for (const compiler of ['xelatex', 'lualatex']) {
    await window.getByTestId('tree-file-main.tex').click()
    await window.getByTestId('compiler-select').selectOption(compiler)
    await window.getByTestId('compile-button').click()
    await waitForCompileToStart(window)
    await expect(window.getByTestId('compile-status')).toContainText('Compiled in', {
      timeout: 180_000,
    })
    await expect(window.getByTestId('pdf-page-indicator')).toContainText(/\/ [1-9]/)
  }
})

test('a project in a path with spaces and umlauts compiles and syncs', async () => {
  test.setTimeout(240_000)
  const base = mkdtempSync(join(tmpdir(), 'openleaf-umlaut-'))
  const project = join(base, 'Übung Bachelor Arbeit', 'Mein Projekt 42')
  cpSync(createSampleProject(), project, { recursive: true })

  const window = await launchApp(project, 'Mein Projekt 42')
  await compileAndAwaitPdf(window)

  // SyncTeX forward still works with spaces/umlauts in the path.
  await window.getByTestId('tree-file-sections/limits.tex').click()
  await window.locator('.cm-content').click()
  await window.keyboard.press('Meta+ArrowUp')
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Meta+Alt+ArrowRight')
  await expect(window.locator('[data-page] .border-2').first()).toBeVisible({ timeout: 15_000 })
})

test('canceling a run-away compile kills the process tree', async () => {
  test.setTimeout(120_000)
  const project = createSampleProject()
  // A pure counter loop: runs forever without consuming memory (the plain
  // \loop+token variant dies of "TeX capacity exceeded" within seconds).
  writeFileSync(
    join(project, 'main.tex'),
    [
      '\\documentclass{article}',
      '\\begin{document}',
      'Start of an endless document.',
      '\\newcount\\olcount',
      '\\olcount=0',
      '\\loop',
      '\\advance\\olcount by 1',
      '\\ifnum\\olcount<2147483647',
      '\\repeat',
      '\\end{document}',
    ].join('\n') + '\n'
  )

  const window = await launchApp(project)
  await window.getByTestId('tree-file-main.tex').click()
  await window.getByTestId('compile-button').click()
  await expect(window.getByTestId('cancel-compile-button')).toBeVisible({ timeout: 60_000 })

  // Wait until pdflatex is actually running for this project before canceling.
  let pid: string | null = null
  for (let i = 0; i < 60 && !pid; i++) {
    pid = pdflatexPidFor(project)
    if (!pid) await window.waitForTimeout(500)
  }
  expect(pid, 'pdflatex process should be running for the project').not.toBeNull()

  await window.getByTestId('cancel-compile-button').click()
  await expect(window.getByTestId('compile-status')).toContainText('Compile canceled', {
    timeout: 15_000,
  })

  // No zombie pdflatex may survive.
  await window.waitForTimeout(1500)
  let stillAlive: string | null = null
  try {
    process.kill(Number(pid), 0)
    stillAlive = pid
  } catch {
    stillAlive = null
  }
  expect(stillAlive, 'pdflatex must be killed after cancel').toBeNull()
})
