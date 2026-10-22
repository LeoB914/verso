#!/usr/bin/env node
/**
 * Verify every built-in template (and the sample project) against the real
 * TeX installation: copy to a temp dir, run the full latexmk pipeline with
 * the compiler(s) the template declares, then check the log for undefined
 * references/citations. Prints a table and exits non-zero on any failure.
 *
 * Usage: npm run verify:templates [-- --keep]
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const templatesRoot = join(fileURLToPath(import.meta.url), '../../resources/templates')
const keep = process.argv.includes('--keep')

const VALID_COMPILERS = new Set(['pdflatex', 'xelatex', 'lualatex'])

function compilersOf(templateJson) {
  if (Array.isArray(templateJson.compilers)) return templateJson.compilers
  return [templateJson.compiler ?? 'pdflatex']
}

function logHasUndefinedReferences(logPath) {
  if (!existsSync(logPath)) return true
  const log = readFileSync(logPath, 'utf8')
  return /undefined (citation|reference)|Citation .* undefined|Reference .* undefined|There were undefined references/i.test(
    log
  )
}

const templateDirs = readdirSync(templatesRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(templatesRoot, d.name))

const baseTmp = mkdtempSync(join(tmpdir(), 'openleaf-verify-templates-'))
const results = []
let failed = 0

for (const dir of templateDirs) {
  const manifestPath = join(dir, 'template.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const mainFile = manifest.mainFile ?? 'main.tex'

  for (const compiler of compilersOf(manifest)) {
    if (!VALID_COMPILERS.has(compiler)) {
      results.push({ template: manifest.id, compiler, ok: false, note: 'unknown compiler' })
      failed++
      continue
    }
    const workDir = join(baseTmp, `${manifest.id}-${compiler}`)
    cpSync(dir, workDir, { recursive: true })
    const outDir = '.openleaf/build'
    const logPath = join(workDir, outDir, `${mainFile.replace(/\.tex$/, '')}.log`)
    let ok = true
    let note = ''
    try {
      execFileSync(
        'latexmk',
        [
          `-${compiler}`,
          '-synctex=1',
          '-interaction=nonstopmode',
          '-file-line-error',
          `-outdir=${outDir}`,
          mainFile,
        ],
        { cwd: workDir, stdio: 'pipe', timeout: 180_000 }
      )
    } catch (err) {
      ok = false
      note = err.status === null ? 'timeout/crash' : `latexmk exit ${err.status}`
    }
    if (ok && logHasUndefinedReferences(logPath)) {
      ok = false
      note = 'undefined references/citations in log'
    }
    if (ok && !existsSync(join(workDir, outDir, `${mainFile.replace(/\.tex$/, '')}.pdf`))) {
      ok = false
      note = 'no PDF produced'
    }
    if (!keep) rmSync(workDir, { recursive: true, force: true })
    results.push({ template: manifest.id, compiler, ok, note })
    if (!ok) failed++
  }
}

if (!keep) rmSync(baseTmp, { recursive: true, force: true })

const width = Math.max(...results.map((r) => r.template.length), 10)
console.log('Template verification against the real TeX installation')
console.log('─'.repeat(width + 24))
for (const r of results) {
  const status = r.ok ? '✓ ok' : '✗ FAIL'
  const note = r.note ? ` — ${r.note}` : ''
  console.log(`${r.template.padEnd(width)}  ${r.compiler.padEnd(9)}  ${status}${note}`)
}
console.log('─'.repeat(width + 24))
console.log(
  results.filter((r) => r.ok).length + '/' + results.length + ' combinations compile cleanly'
)

if (failed > 0) {
  console.error(`${failed} combination(s) FAILED`)
  process.exit(1)
}
