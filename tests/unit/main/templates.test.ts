import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyDirectory,
  findBuiltInTemplatesDir,
  isValidTemplateId,
} from '../../../src/main/project/templates'

const repoRoot = resolve(__dirname, '../../..')
const templatesDir = join(repoRoot, 'resources', 'templates')

describe('built-in template lookup', () => {
  it('finds resources/templates from the repo root (electron .)', () => {
    expect(findBuiltInTemplatesDir(repoRoot)).toBe(templatesDir)
  })

  it('finds it from out/main (E2E launches the bundled entry directly)', () => {
    expect(findBuiltInTemplatesDir(join(repoRoot, 'out', 'main'))).toBe(templatesDir)
  })

  it('does not depend on the working directory (Finder launches use "/")', () => {
    expect(findBuiltInTemplatesDir('/')).toBeNull()
  })
})

describe('template ids', () => {
  it('accepts folder-style ids and rejects traversal', () => {
    expect(isValidTemplateId('report-thesis')).toBe(true)
    expect(isValidTemplateId('my_template.v2')).toBe(true)
    expect(isValidTemplateId('..')).toBe(false)
    expect(isValidTemplateId('../secret')).toBe(false)
    expect(isValidTemplateId('a/b')).toBe(false)
    expect(isValidTemplateId('')).toBe(false)
  })
})

describe('copyDirectory', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  it('copies nested files byte for byte', async () => {
    const source = mkdtempSync(join(tmpdir(), 'verso-tpl-src-'))
    const target = join(mkdtempSync(join(tmpdir(), 'verso-tpl-dst-')), 'project')
    dirs.push(source, target)
    mkdirSync(join(source, 'chapters'))
    writeFileSync(join(source, 'main.tex'), '\\documentclass{report}\n')
    writeFileSync(join(source, 'chapters', 'intro.tex'), 'Intro\n')
    writeFileSync(join(source, 'logo.png'), Buffer.from([0, 255, 7]))
    await copyDirectory(source, target)
    expect(readFileSync(join(target, 'chapters', 'intro.tex'), 'utf8')).toBe('Intro\n')
    expect([...readFileSync(join(target, 'logo.png'))]).toEqual([0, 255, 7])
  })
})
