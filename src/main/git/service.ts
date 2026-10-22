import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'

/**
 * Git service via simple-git (uses the system git; degrade gracefully when
 * missing). Never touches credentials — the user's SSH agent / credential
 * helper is used as configured.
 */

export interface GitAvailability {
  available: boolean
  version: string | null
}

export async function checkGitAvailable(): Promise<GitAvailability> {
  try {
    const git = simpleGit()
    const version = await git.version()
    return { available: true, version: String(version) }
  } catch {
    return { available: false, version: null }
  }
}

export function gitFor(root: string): SimpleGit {
  return simpleGit({ baseDir: root })
}

export function isRepo(root: string): boolean {
  try {
    return fs.existsSync(path.join(root, '.git'))
  } catch {
    return false
  }
}

const LATEX_GITIGNORE = [
  '# LaTeX build artifacts',
  '*.aux',
  '*.log',
  '*.out',
  '*.toc',
  '*.synctex.gz',
  '*.fls',
  '*.fdb_latexmk',
  '*.blg',
  '*.bbl',
  '',
  '# Verso',
  '.openleaf/build/',
  '',
  '# OS junk',
  '.DS_Store',
  'Thumbs.db',
  '',
].join('\n')

/** Initialize a repository with a sensible LaTeX .gitignore. */
export async function initRepo(root: string): Promise<void> {
  await gitFor(root).init()
  const gitignorePath = path.join(root, '.gitignore')
  let existing = ''
  try {
    existing = await fsPromises.readFile(gitignorePath, 'utf8')
  } catch {
    // No .gitignore yet.
  }
  if (!existing.includes('.openleaf/build/')) {
    const lines = existing.split(/\r?\n/).map((line) => line.trim())
    const needed = LATEX_GITIGNORE.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const missing = needed.filter((line) => !lines.includes(line))
    if (missing.length > 0) {
      const content =
        (existing.length > 0 && !existing.endsWith('\n') ? existing + '\n' : existing) +
        missing.join('\n') +
        '\n'
      await fsPromises.writeFile(gitignorePath, content)
    }
  }
}

export interface GitFileStatus {
  path: string
  /** Porcelain status letter (M, A, D, R, ? …). */
  status: string
  staged: boolean
}

export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  conflicted: string[]
}

export async function getStatus(root: string): Promise<GitStatus | null> {
  if (!isRepo(root)) return null
  const git = gitFor(root)
  const status: StatusResult = await git.status()
  const files: GitFileStatus[] = []
  for (const file of status.files) {
    const staged = status.staged.includes(file.path)
    files.push({
      path: file.path,
      status: file.index !== ' ' && file.index !== '?' ? file.index : file.working_dir,
      staged,
    })
  }
  return {
    branch: status.current,
    ahead: status.ahead ?? 0,
    behind: status.behind ?? 0,
    files,
    conflicted: status.conflicted,
  }
}

export async function stage(root: string, paths: string[]): Promise<void> {
  await gitFor(root).add(paths)
}

export async function unstage(root: string, paths: string[]): Promise<void> {
  await gitFor(root).reset(['HEAD', '--', ...paths])
}

export async function commit(
  root: string,
  message: string,
  amend = false,
  author?: { name: string; email: string }
): Promise<string | null> {
  const git = gitFor(root)
  const options: Record<string, string | null> = {}
  if (amend) {
    options['--amend'] = null
    options['--no-edit'] = null
  }
  if (author) options['--author'] = `${author.name} <${author.email}>`
  await git.commit(message, options as never)
  const log = await git.log({ maxCount: 1 })
  return log.latest?.hash ?? null
}

export interface CommitInfo {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

export async function getLog(root: string, maxCount = 100): Promise<CommitInfo[]> {
  if (!isRepo(root)) return []
  try {
    const log = await gitFor(root).log({ maxCount })
    return log.all.map((entry) => ({
      hash: entry.hash,
      shortHash: entry.hash.slice(0, 7),
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
    }))
  } catch {
    return []
  }
}

export async function listBranches(root: string): Promise<string[]> {
  if (!isRepo(root)) return []
  const branches = await gitFor(root).branchLocal()
  return branches.all
}

export async function currentBranch(root: string): Promise<string | null> {
  if (!isRepo(root)) return null
  const status = await getStatus(root)
  return status?.branch ?? null
}

export async function createBranch(root: string, name: string): Promise<void> {
  await gitFor(root).checkout(['-b', name])
}

export async function checkoutBranch(root: string, name: string): Promise<void> {
  await gitFor(root).checkout(name)
}

/** Fetch and compute ahead/behind counts. */
export async function fetchRemote(root: string): Promise<{ ahead: number; behind: number } | null> {
  if (!isRepo(root)) return null
  const git = gitFor(root)
  try {
    await git.fetch()
    const summary = await git.status()
    return { ahead: summary.ahead ?? 0, behind: summary.behind ?? 0 }
  } catch {
    return null
  }
}

export async function push(root: string, setUpstream = false): Promise<string | null> {
  const git = gitFor(root)
  try {
    if (setUpstream) {
      const branch = await currentBranch(root)
      if (!branch) return null
      await git.push(['--set-upstream', 'origin', branch])
    } else {
      await git.push()
    }
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export async function pull(root: string): Promise<string | null> {
  try {
    await gitFor(root).pull()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** Files changed by a commit (name-status against its first parent). */
export async function listCommitFiles(
  root: string,
  commitHash: string
): Promise<Array<{ path: string; status: string }>> {
  if (!isRepo(root)) return []
  try {
    // --root makes the very first commit list its files as added.
    const output = await gitFor(root).raw([
      'show',
      '--name-status',
      '--format=',
      '--root',
      '-M',
      commitHash,
      '--',
    ])
    return parseNameStatus(output)
  } catch {
    return []
  }
}

/** Parse `git show --name-status` output (tab separated; renames list the new path). */
export function parseNameStatus(output: string): Array<{ path: string; status: string }> {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      return { status: parts[0].charAt(0), path: parts[parts.length - 1] }
    })
    .filter((entry) => entry.path.length > 0)
}

/** Read a file's content at a commit (empty string for untracked/deleted). */
export async function showFileAtCommit(
  root: string,
  commitHash: string,
  relPath: string
): Promise<string | null> {
  try {
    const result = await gitFor(root).show([`${commitHash}:${relPath}`])
    return result
  } catch {
    return null
  }
}
