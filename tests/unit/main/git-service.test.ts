import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getStatus,
  stage,
  commit,
  getLog,
  listBranches,
  createBranch,
  checkoutBranch,
  isRepo,
  showFileAtCommit,
  listCommitFiles,
  parseNameStatus,
} from '../../../src/main/git/service'
import { gitBranchName, gitRevision } from '../../../src/shared/ipc'

function gitRun(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
}

describe('git service', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openleaf-git-'))
    try {
      gitRun(root, 'init -b main')
    } catch {
      // git < 2.28 does not know -b yet; point the unborn HEAD at main.
      gitRun(root, 'init')
      gitRun(root, 'symbolic-ref HEAD refs/heads/main')
    }
    gitRun(root, 'config user.email test@example.com')
    gitRun(root, 'config user.name "Test User"')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('detects repos', () => {
    expect(isRepo(root)).toBe(true)
    expect(isRepo(join(root, 'sub'))).toBe(false)
  })

  it('reports status with staged/unstaged files', async () => {
    writeFileSync(join(root, 'main.tex'), 'one\n')
    const before = await getStatus(root)
    expect(before?.files.some((f) => f.path === 'main.tex')).toBe(true)

    await stage(root, ['main.tex'])
    await commit(root, 'initial commit')
    const after = await getStatus(root)
    expect(after?.branch).toBeTypeOf('string')
    expect(after?.files.length).toBe(0)
  })

  it('commits and reads the log', async () => {
    writeFileSync(join(root, 'main.tex'), 'one\n')
    await stage(root, ['main.tex'])
    const hash = await commit(root, 'my message')
    expect(hash).toBeTruthy()
    const log = await getLog(root)
    expect(log[0].message).toBe('my message')
    expect(log[0].author).toBe('Test User')
  })

  it('creates and switches branches', async () => {
    writeFileSync(join(root, 'main.tex'), 'one\n')
    await stage(root, ['main.tex'])
    await commit(root, 'initial')
    await createBranch(root, 'feature-x')
    expect(await listBranches(root)).toContain('feature-x')
    await checkoutBranch(root, 'main')
    const status = await getStatus(root)
    expect(status?.branch).toBe('main')
  })

  it('reads file contents at a commit', async () => {
    writeFileSync(join(root, 'main.tex'), 'version one\n')
    await stage(root, ['main.tex'])
    const first = await commit(root, 'first')
    writeFileSync(join(root, 'main.tex'), 'version two\n')
    await stage(root, ['main.tex'])
    await commit(root, 'second')
    const content = await showFileAtCommit(root, first!, 'main.tex')
    expect(content).toBe('version one\n')
  })

  it('detects conflicted files', async () => {
    // Create a merge conflict scenario.
    writeFileSync(join(root, 'main.tex'), 'base\n')
    await stage(root, ['main.tex'])
    await commit(root, 'base')
    await createBranch(root, 'side')
    await checkoutBranch(root, 'side')
    writeFileSync(join(root, 'main.tex'), 'side\n')
    await stage(root, ['main.tex'])
    await commit(root, 'side change')
    await checkoutBranch(root, 'main')
    writeFileSync(join(root, 'main.tex'), 'main\n')
    await stage(root, ['main.tex'])
    await commit(root, 'main change')
    // Merge (expect failure) then verify conflict detection.
    try {
      gitRun(root, 'merge side --no-edit')
    } catch {
      // Conflict expected.
    }
    const status = await getStatus(root)
    expect(status?.conflicted).toContain('main.tex')
    expect(readFileSync(join(root, 'main.tex'), 'utf8')).toContain('<<<<<<<')
  })

  it('lists the files of a commit, including the very first one', async () => {
    writeFileSync(join(root, 'main.tex'), 'one\n')
    writeFileSync(join(root, 'refs.bib'), '@misc{a}\n')
    await stage(root, ['main.tex', 'refs.bib'])
    const first = await commit(root, 'first')
    writeFileSync(join(root, 'main.tex'), 'two\n')
    gitRun(root, 'rm -q refs.bib')
    await stage(root, ['main.tex'])
    const second = await commit(root, 'second')
    expect(await listCommitFiles(root, first!)).toEqual([
      { status: 'A', path: 'main.tex' },
      { status: 'A', path: 'refs.bib' },
    ])
    expect(await listCommitFiles(root, second!)).toEqual([
      { status: 'M', path: 'main.tex' },
      { status: 'D', path: 'refs.bib' },
    ])
    // The parent revision (hash^) is readable for the diff's left side.
    expect(await showFileAtCommit(root, `${second}^`, 'main.tex')).toBe('one\n')
  })
})

describe('git helpers', () => {
  it('parses name-status output (renames list the new path)', () => {
    expect(parseNameStatus('M\tmain.tex\nR100\told.tex\tnew.tex\n\n')).toEqual([
      { status: 'M', path: 'main.tex' },
      { status: 'R', path: 'new.tex' },
    ])
  })

  it('accepts sensible branch names and rejects option-like or invalid ones', () => {
    for (const ok of ['main', 'chapter-3', 'feature/intro.v2', 'fix_typo']) {
      expect(gitBranchName.safeParse(ok).success, ok).toBe(true)
    }
    for (const bad of ['-f', '--orphan', 'a..b', 'a//b', 'name.lock', 'ends/', 'has space', '']) {
      expect(gitBranchName.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('only accepts commit hashes (optionally ^) as revisions', () => {
    expect(gitRevision.safeParse('a1b2c3d').success).toBe(true)
    expect(gitRevision.safeParse('a1b2c3d^').success).toBe(true)
    expect(gitRevision.safeParse('--output=/tmp/x').success).toBe(false)
    expect(gitRevision.safeParse('HEAD~1').success).toBe(false)
  })
})
