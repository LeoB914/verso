import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildProjectZip } from '../../../src/main/project/zip'

describe('project ZIP export', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'verso-zip-export-'))
    mkdirSync(join(root, 'chapters'))
    mkdirSync(join(root, '.openleaf', 'build'), { recursive: true })
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, 'main.tex'), '\\documentclass{article}\n')
    writeFileSync(join(root, 'chapters', 'intro.tex'), 'Intro\n')
    writeFileSync(join(root, '.openleaf', 'project.json'), JSON.stringify({ mainFile: 'main.tex' }))
    writeFileSync(join(root, '.openleaf', 'build', 'main.pdf'), '%PDF-1.5')
    writeFileSync(join(root, '.openleaf', 'build', 'main.aux'), 'aux')
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main')
    writeFileSync(join(root, '.DS_Store'), 'junk')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const entries = async (buffer: Buffer): Promise<string[]> =>
    Object.values((await JSZip.loadAsync(buffer)).files)
      .filter((file) => !file.dir)
      .map((file) => file.name)
      .sort()

  it('contains the sources but no build output, .git or junk files', async () => {
    expect(await entries(await buildProjectZip(root, false))).toEqual([
      '.openleaf/project.json',
      'chapters/intro.tex',
      'main.tex',
    ])
  })

  it('adds the compiled PDF at the top level on request', async () => {
    expect(await entries(await buildProjectZip(root, true))).toContain('main.pdf')
  })
})
