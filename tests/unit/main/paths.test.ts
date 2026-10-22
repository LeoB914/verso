import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PathSafetyError, resolveInProject } from '../../../src/main/util/paths'

describe('resolveInProject', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openleaf-path-safety-'))
    mkdirSync(join(root, 'sections'))
    writeFileSync(join(root, 'main.tex'), 'hello')
    writeFileSync(join(root, 'sections', 'intro.tex'), 'intro')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('resolves simple relative paths', async () => {
    const result = await resolveInProject(root, 'main.tex')
    // macOS /tmp is a symlink to /private/tmp, so compare realpaths.
    expect(result).toBe(realpathSync(join(root, 'main.tex')))
  })

  it('resolves nested paths with ./ segments', async () => {
    const result = await resolveInProject(root, './sections/intro.tex')
    expect(result).toBe(realpathSync(join(root, 'sections', 'intro.tex')))
  })

  it('rejects traversal outside the project', async () => {
    await expect(resolveInProject(root, '../escape.txt')).rejects.toThrow(PathSafetyError)
  })

  it('rejects absolute paths', async () => {
    await expect(resolveInProject(root, '/etc/passwd')).rejects.toThrow(PathSafetyError)
    await expect(resolveInProject(root, 'C:\\Users\\evil')).rejects.toThrow(PathSafetyError)
  })

  it('rejects symlinked files pointing outside the project', async () => {
    const outside = join(root, '..', `outside-${Date.now()}.txt`)
    writeFileSync(outside, 'secret')
    try {
      symlinkSync(outside, join(root, 'leak.txt'))
      await expect(resolveInProject(root, 'leak.txt')).rejects.toThrow(PathSafetyError)
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('rejects symlinked directories pointing outside the project', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'openleaf-outside-'))
    try {
      symlinkSync(outsideDir, join(root, 'evil-dir'))
      await expect(resolveInProject(root, 'evil-dir/file.txt')).rejects.toThrow(PathSafetyError)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects NUL bytes and empty paths', async () => {
    await expect(resolveInProject(root, 'main\0.tex')).rejects.toThrow(PathSafetyError)
    await expect(resolveInProject(root, '')).rejects.toThrow(PathSafetyError)
  })

  it('rejects a dangling symlink whose target lies outside the project', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'openleaf-outside-'))
    const outsideFile = join(outsideDir, 'evil.tex')
    try {
      symlinkSync(outsideFile, join(root, 'link.tex'))
      await expect(resolveInProject(root, 'link.tex')).rejects.toThrow(PathSafetyError)
      // Creating a file through the link must fail and must not write outside.
      const { createFileOrFolder } = await import('../../../src/main/project/files')
      await expect(
        createFileOrFolder(root, 'link.tex', 'file', 'written-through-symlink')
      ).rejects.toThrow(PathSafetyError)
      expect(existsSync(outsideFile)).toBe(false)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('allows a symlink that points inside the project', async () => {
    symlinkSync(join(root, 'main.tex'), join(root, 'alias.tex'))
    await expect(resolveInProject(root, 'alias.tex')).resolves.toBeTruthy()
  })

  it('rejects paths into a non-existent project', async () => {
    await expect(resolveInProject(join(root, 'missing-dir'), 'main.tex')).rejects.toThrow(
      PathSafetyError
    )
  })
})
