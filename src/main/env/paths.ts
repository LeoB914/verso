import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * macOS GUI apps do not inherit the interactive shell's PATH. At startup we
 * resolve PATH by asking the user's login shell once, then probe known
 * locations for TeX and Homebrew as a fallback.
 */

export interface ResolvedPath {
  paths: string[]
  /** How this list was assembled, for diagnostics. */
  source: 'login-shell' | 'fallback' | 'merged'
}

function probeExistingDirs(dirs: string[]): string[] {
  return dirs.filter((d) => {
    try {
      return fs.statSync(d).isDirectory()
    } catch {
      return false
    }
  })
}

/** Sentinel framing so shell startup noise cannot pollute the PATH value. */
export const PATH_BEGIN = '__OL_PATH_BEGIN__'
export const PATH_END = '__OL_PATH_END__'

/**
 * Extract PATH entries from the shell's stdout. Only the text between the
 * sentinels is used, so banners/prompts from .zshrc/.bashrc/config.fish are
 * ignored. fish prints its list as a ':'-joined string the same way.
 */
export function parseShellPathOutput(stdout: string, delimiter = ':'): string[] {
  const begin = stdout.lastIndexOf(PATH_BEGIN)
  if (begin === -1) return []
  const end = stdout.indexOf(PATH_END, begin + PATH_BEGIN.length)
  if (end === -1) return []
  const value = stdout.slice(begin + PATH_BEGIN.length, end).trim()
  if (!value) return []
  return value.split(delimiter).filter(Boolean)
}

function platformKnownDirs(): string[] {
  switch (process.platform) {
    case 'darwin':
      return [
        '/Library/TeX/texbin',
        '/usr/local/texlive/*/bin/*',
        '/opt/homebrew/bin',
        '/usr/local/bin',
      ]
    case 'win32': {
      const known: string[] = []
      // MiKTeX and TeX Live default locations, expanded below.
      known.push(
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
        'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64',
        // Any TeX Live year; the glob expander is separator-aware.
        'C:\\texlive\\*\\bin\\windows'
      )
      return known
    }
    default:
      return ['/usr/local/texlive/*/bin/*']
  }
}

/**
 * Expand glob-ish `*` segments in known-location paths. Separator-aware: works
 * with POSIX paths and Windows drive paths (`C:\texlive\*\bin\windows`).
 */
export function expandGlobs(
  dirs: string[],
  readdir: (dir: string) => string[] = (dir) => fs.readdirSync(dir)
): string[] {
  const result: string[] = []
  for (const dir of dirs) {
    if (!dir.includes('*')) {
      result.push(dir)
      continue
    }
    const isWindows = /^[A-Za-z]:/.test(dir)
    const separator = isWindows ? '\\' : '/'
    const segments = dir.split(/[\\/]/)
    const root = isWindows ? segments[0] + separator : ''
    const rest = segments.slice(1)
    let current = [root]
    for (const segment of rest) {
      if (!segment.includes('*')) {
        current = current.map((base) => {
          if (isWindows) return base.endsWith('\\') ? base + segment : base + '\\' + segment
          return base ? path.join(base, segment) : path.join(path.sep, segment)
        })
        continue
      }
      const next: string[] = []
      for (const base of current) {
        const parent = base || path.parse(dir).root
        try {
          const entries = readdir(parent)
          const pattern = new RegExp('^' + segment.replaceAll('*', '[^.]*') + '$')
          for (const entry of entries) {
            if (pattern.test(entry)) {
              next.push(
                isWindows
                  ? base.endsWith('\\')
                    ? base + entry
                    : base + '\\' + entry
                  : path.join(base, entry)
              )
            }
          }
        } catch {
          // Directory may not exist; ignore.
        }
      }
      current = next
    }
    result.push(...current)
  }
  return result
}

async function loginShellPath(timeoutMs = 3000): Promise<string | null> {
  const shell = process.env.SHELL
  if (!shell) return null
  const command = `printf '${PATH_BEGIN}%s${PATH_END}' "$PATH"`
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const child = execFile(shell, ['-ilc', command], { timeout: timeoutMs }, (err, stdout) => {
      if (timer) clearTimeout(timer)
      if (err && !stdout) return finish(null)
      finish(stdout || null)
    })
    timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, timeoutMs)
    child.on('error', () => {
      if (timer) clearTimeout(timer)
      finish(null)
    })
  })
}

/** Login-shell PATH as a list (sentinel-parsed; empty when unavailable). */
export async function loginShellPaths(): Promise<string[]> {
  const raw = await loginShellPath()
  return raw ? parseShellPathOutput(raw, path.delimiter) : []
}

export async function resolveSystemPath(): Promise<ResolvedPath> {
  const envPath = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const shellPaths = await loginShellPaths()
  const probed = expandGlobs(probeExistingDirs(platformKnownDirs()))

  const merged = [...new Set([...shellPaths, ...probed, ...envPath])]
  return { paths: merged, source: shellPaths.length > 0 ? 'merged' : 'fallback' }
}
