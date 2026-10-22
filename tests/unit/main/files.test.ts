import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { duplicatePath, importExternalFile, renameOrMove } from '../../../src/main/project/files'

describe('renameOrMove', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openleaf-rename-'))
    mkdirSync(join(root, 'figures'))
    writeFileSync(join(root, 'figures', 'a.tex'), 'AAA\n')
    writeFileSync(join(root, 'figures', 'b.tex'), 'BBB\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('refuses to overwrite an existing file and changes nothing', async () => {
    await expect(renameOrMove(root, 'figures/a.tex', 'figures/b.tex')).rejects.toMatchObject({
      code: 'exists',
    })
    expect(readFileSync(join(root, 'figures', 'a.tex'), 'utf8')).toBe('AAA\n')
    expect(readFileSync(join(root, 'figures', 'b.tex'), 'utf8')).toBe('BBB\n')
  })

  it('allows a pure case change of the same file', async () => {
    writeFileSync(join(root, 'figures', 'Case.tex'), 'Case\n')
    await renameOrMove(root, 'figures/Case.tex', 'figures/case.tex')
    expect(readFileSync(join(root, 'figures', 'case.tex'), 'utf8')).toBe('Case\n')
  })

  it('renames to a free name', async () => {
    await renameOrMove(root, 'figures/a.tex', 'figures/c.tex')
    expect(readFileSync(join(root, 'figures', 'c.tex'), 'utf8')).toBe('AAA\n')
  })

  it('moves a file into a subfolder', async () => {
    mkdirSync(join(root, 'sections'))
    await renameOrMove(root, 'figures/a.tex', 'sections/a.tex')
    expect(readFileSync(join(root, 'sections', 'a.tex'), 'utf8')).toBe('AAA\n')
  })
})

describe('root-level operations', () => {
  let root: string
  let outside: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openleaf-rootops-'))
    outside = mkdtempSync(join(tmpdir(), 'openleaf-rootops-src-'))
    writeFileSync(join(root, 'main.tex'), 'ROOT\n')
    writeFileSync(join(outside, 'pic.png'), 'PNG')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('renames a file in the project root', async () => {
    await renameOrMove(root, 'main.tex', 'renamed.tex')
    expect(readFileSync(join(root, 'renamed.tex'), 'utf8')).toBe('ROOT\n')
  })

  it('duplicates a file in the project root', async () => {
    expect(await duplicatePath(root, 'main.tex')).toBe('main copy.tex')
    expect(readFileSync(join(root, 'main copy.tex'), 'utf8')).toBe('ROOT\n')
  })

  it('imports into the project root with targetDir ""', async () => {
    expect(await importExternalFile(root, join(outside, 'pic.png'), '')).toBe('pic.png')
    expect(readFileSync(join(root, 'pic.png'), 'utf8')).toBe('PNG')
  })
})

describe('duplicatePath / importExternalFile', () => {
  let root: string
  let outside: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openleaf-duplicate-'))
    outside = mkdtempSync(join(tmpdir(), 'openleaf-outside-'))
    mkdirSync(join(root, 'figures'))
    writeFileSync(join(root, 'figures', 'a.tex'), 'AAA\n')
    writeFileSync(join(outside, 'pic.png'), 'PNG')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('finds a free name for the first duplicate', async () => {
    const target = await duplicatePath(root, 'figures/a.tex')
    expect(target).toBe('figures/a copy.tex')
    expect(readFileSync(join(root, target), 'utf8')).toBe('AAA\n')
  })

  it('numbers further duplicates and terminates quickly', async () => {
    const started = Date.now()
    expect(await duplicatePath(root, 'figures/a.tex')).toBe('figures/a copy.tex')
    expect(await duplicatePath(root, 'figures/a.tex')).toBe('figures/a copy-2.tex')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('imports an image twice with unique names', async () => {
    expect(await importExternalFile(root, join(outside, 'pic.png'), 'figures')).toBe(
      'figures/pic.png'
    )
    expect(await importExternalFile(root, join(outside, 'pic.png'), 'figures')).toBe(
      'figures/pic-2.png'
    )
    expect(readFileSync(join(root, 'figures', 'pic-2.png'), 'utf8')).toBe('PNG')
  })
})
