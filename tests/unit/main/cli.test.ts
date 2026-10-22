import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findProjectDirectoryArg } from '../../../src/main/util/cli'

describe('findProjectDirectoryArg', () => {
  it('ignores the relative entry electron-vite passes in dev', () => {
    expect(findProjectDirectoryArg(['.'], { cwd: '/tmp', appPath: '/tmp/app' })).toBeNull()
  })

  it('ignores the app directory, cwd and flags', () => {
    const root = mkdtempSync(join(tmpdir(), 'openleaf-cli-'))
    const appPath = join(root, 'app')
    const cwd = join(root, 'cwd')
    mkdirSync(appPath)
    mkdirSync(cwd)
    expect(findProjectDirectoryArg([appPath, cwd, '--flag'], { cwd, appPath })).toBeNull()
  })

  it('accepts an absolute project directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'openleaf-cli-'))
    const project = join(root, 'project')
    mkdirSync(project)
    expect(
      findProjectDirectoryArg(['.', join(root, 'out/main/index.js'), project], {
        cwd: join(root, 'cwd'),
        appPath: join(root, 'app'),
      })
    ).toBe(project)
  })
})
