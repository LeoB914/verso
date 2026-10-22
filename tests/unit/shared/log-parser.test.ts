import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countErrors, parseLog } from '../../../src/shared/latex/log-parser'

const fixtureDir = join(__dirname, '../../../tests/fixtures/logs')

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8')
}

describe('parseLog', () => {
  it('extracts file-line-error entries with file and line', () => {
    const entries = parseLog(loadFixture('undefined-control-sequence.log'))
    const errors = entries.filter((e) => e.level === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(2)
    expect(errors[0].file).toBe('sections/intro.tex')
    expect(errors[0].line).toBe(12)
    expect(errors[0].message).toContain('Undefined control sequence')
    expect(errors[1].file).toBe('main.tex')
    expect(errors[1].line).toBe(33)
  })

  it('recovers file-line-error entries whose path wrapped at 79 chars', () => {
    const wrapped = [
      'LaTeX Warning: Empty bibliography on input line 45.',
      '',
      '/var/folders/qs/T/openleaf-compile-PsFxIO/main.t',
      'ex:46: Undefined control sequence.',
      '<recently read> \\undefinedcommand',
      '',
      'l.46 \\undefinedcommand',
    ].join('\n')
    const entries = parseLog(wrapped)
    const errors = entries.filter((e) => e.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toBe('/var/folders/qs/T/openleaf-compile-PsFxIO/main.tex')
    expect(errors[0].line).toBe(46)
    expect(errors[0].message).toContain('Undefined control sequence')
  })

  it('extracts missing package errors', () => {
    const entries = parseLog(loadFixture('missing-package.log'))
    const errors = entries.filter((e) => e.level === 'error')
    expect(errors.some((e) => e.message.includes("File `nonexistent.sty' not found"))).toBe(true)
    expect(errors.some((e) => e.message.includes('Emergency stop'))).toBe(true)
    expect(countErrors(entries)).toBeGreaterThan(0)
  })

  it('extracts missing $ errors with line number', () => {
    const entries = parseLog(loadFixture('missing-dollar.log'))
    const errors = entries.filter((e) => e.level === 'error')
    const missingDollar = errors.find((e) => e.message.includes('Missing $'))
    expect(missingDollar).toBeDefined()
    expect(missingDollar?.line).toBe(15)
  })

  it('extracts undefined citations as warnings', () => {
    const entries = parseLog(loadFixture('undefined-citation.log'))
    const warnings = entries.filter((e) => e.level === 'warning')
    const citation = warnings.find((w) => w.message.includes('knuth1984'))
    expect(citation).toBeDefined()
    expect(citation?.line).toBe(25)
    expect(warnings.some((w) => w.message.includes('goossens93'))).toBe(true)
  })

  it('extracts undefined references as warnings', () => {
    const entries = parseLog(loadFixture('undefined-reference.log'))
    const warning = entries.find((e) => e.message.includes('fig:architecture'))
    expect(warning).toBeDefined()
    expect(warning?.level).toBe('warning')
    expect(warning?.line).toBe(42)
  })

  it('extracts overfull/underfull boxes as info', () => {
    const entries = parseLog(loadFixture('overfull-box.log'))
    const infos = entries.filter((e) => e.level === 'info')
    expect(infos.some((i) => i.message.includes('Overfull'))).toBe(true)
    expect(infos.some((i) => i.message.includes('Underfull'))).toBe(true)
    expect(countErrors(entries)).toBe(0)
  })

  it('extracts package warnings', () => {
    const entries = parseLog(loadFixture('package-warning.log'))
    const warnings = entries.filter((e) => e.level === 'warning')
    expect(warnings.some((w) => w.message.includes('Package hyperref'))).toBe(true)
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('extracts babel package errors', () => {
    const entries = parseLog(loadFixture('babel-package-error.log'))
    const errors = entries.filter((e) => e.level === 'error')
    expect(errors.some((e) => e.message.toLowerCase().includes('babel'))).toBe(true)
    expect(errors.some((e) => e.line === 8)).toBe(true)
  })

  it('flags biber/bibtex failures as errors', () => {
    const entries = parseLog(loadFixture('biber-error.log'))
    expect(countErrors(entries)).toBeGreaterThan(0)
    const biberEntry = entries.find(
      (e) => e.message.includes('BibTeX') || e.message.includes('no \\bibdata')
    )
    expect(biberEntry).toBeDefined()
  })

  it('a clean log produces no error entries', () => {
    const entries = parseLog(loadFixture('success.log'))
    expect(countErrors(entries)).toBe(0)
  })

  it('deduplicates identical entries', () => {
    const log = loadFixture('undefined-citation.log')
    const entries = parseLog(log + log)
    const uniqueKeys = new Set(entries.map((e) => `${e.level}|${e.message}`))
    expect(entries.length).toBe(uniqueKeys.size)
  })
})
