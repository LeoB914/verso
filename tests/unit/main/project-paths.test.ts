import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalProjectPath, dedupeProjectEntries } from '../../../src/main/util/project-paths'

interface Entry {
  path: string
  lastOpened: number
  tags: string[]
}

describe('canonicalProjectPath', () => {
  it('normalises trailing slashes and .. segments', () => {
    const root = mkdtempSync(join(tmpdir(), 'openleaf-paths-'))
    const project = join(root, 'project')
    mkdirSync(project)
    const canonical = canonicalProjectPath(project)
    expect(canonicalProjectPath(project + '/')).toBe(canonical)
    expect(canonicalProjectPath(join(project, '..', 'project'))).toBe(canonical)
  })

  it('resolves symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'openleaf-paths-'))
    const project = join(root, 'project')
    const link = join(root, 'link')
    mkdirSync(project)
    symlinkSync(project, link)
    expect(canonicalProjectPath(link)).toBe(canonicalProjectPath(project))
  })
})

describe('dedupeProjectEntries', () => {
  it('merges entries for the same folder and keeps the newest timestamp', () => {
    const root = mkdtempSync(join(tmpdir(), 'openleaf-paths-'))
    const project = join(root, 'project')
    mkdirSync(project)
    const entries: Entry[] = [
      { path: project, lastOpened: 100, tags: ['a'] },
      { path: project + '/', lastOpened: 200, tags: ['b'] },
      { path: join(project, '..', 'project'), lastOpened: 150, tags: [] },
    ]
    const result = dedupeProjectEntries(entries)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe(canonicalProjectPath(project))
    expect(result[0].lastOpened).toBe(200)
    expect(result[0].tags.sort()).toEqual(['a', 'b'])
  })
})
