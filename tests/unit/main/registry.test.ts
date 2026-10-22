import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const memory = new Map<string, unknown>()
vi.mock('../../../src/main/store', () => ({
  getAppStore: () => ({
    get: (key: string) => memory.get(key) ?? (key === 'projects' ? [] : null),
    set: (key: string, value: unknown) => memory.set(key, value),
  }),
  getSettings: () => ({ defaultProjectDir: null }),
}))

import {
  duplicateProject,
  listProjects,
  registerProjectPath,
  renameProjectFolder,
  setProjectTags,
} from '../../../src/main/project/registry'
import { historyDir, setHistoryBaseDir } from '../../../src/main/history/snapshots'

describe('project registry', () => {
  let parent: string
  let project: string

  beforeEach(() => {
    memory.clear()
    parent = realpathSync(mkdtempSync(join(tmpdir(), 'verso-registry-')))
    setHistoryBaseDir(mkdtempSync(join(tmpdir(), 'verso-registry-ud-')))
    project = join(parent, 'Thesis')
    mkdirSync(project)
    writeFileSync(join(project, 'main.tex'), '\\documentclass{article}\n')
    registerProjectPath(project)
    setProjectTags(project, ['uni'])
  })
  afterEach(() => rmSync(parent, { recursive: true, force: true }))

  it('duplicating keeps the original entry and adds one for the copy', async () => {
    const copy = await duplicateProject(project)
    const paths = listProjects().map((entry) => entry.path)
    expect(paths).toContain(project)
    expect(paths).toContain(copy)
    expect(listProjects().find((entry) => entry.path === project)?.tags).toEqual(['uni'])
    expect(listProjects().find((entry) => entry.path === copy)?.tags).toEqual(['uni'])
  })

  it('renaming the folder carries the version history along', async () => {
    mkdirSync(historyDir(project), { recursive: true })
    writeFileSync(join(historyDir(project), 'index.json'), '[]')
    const renamed = await renameProjectFolder(project, 'Thesis 2026')
    expect(renamed).not.toBeNull()
    expect(existsSync(join(historyDir(renamed!), 'index.json'))).toBe(true)
    expect(listProjects().map((entry) => entry.path)).toEqual([renamed])
  })
})
