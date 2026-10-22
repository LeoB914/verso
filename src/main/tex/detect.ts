import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import type { TeXToolName, TexEnvironment, TexTool } from '@shared/ipc'
import { resolveSystemPath } from '../env/paths'

/** Tools to locate, in priority order. */
const TOOL_NAMES: TeXToolName[] = [
  'latexmk',
  'pdflatex',
  'xelatex',
  'lualatex',
  'biber',
  'bibtex',
  'synctex',
  'texcount',
  'perl',
]

const EXECUTABLE_SUFFIX = process.platform === 'win32' ? '.exe' : ''

/** Check whether `dir/name` (with platform suffix) is an executable file. */
export function isExecutableFile(dir: string, name: string): boolean {
  const full = path.join(dir, name + EXECUTABLE_SUFFIX)
  try {
    const stat = fs.statSync(full)
    return stat.isFile()
  } catch {
    return false
  }
}

/**
 * Locate tools by scanning candidate directories (pure over an injectable
 * existence check, so it can be unit-tested without a real filesystem).
 */
export function locateTools(
  dirs: string[],
  names: string[],
  exists: (dir: string, name: string) => boolean = isExecutableFile
): Partial<Record<string, string>> {
  const found: Partial<Record<string, string>> = {}
  for (const name of names) {
    for (const dir of dirs) {
      if (exists(dir, name)) {
        found[name] = path.join(dir, name + EXECUTABLE_SUFFIX)
        break
      }
    }
  }
  return found
}

/** Run `<tool> --version` and return the first line, or null. */
export function readVersion(toolPath: string, timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: string | null) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    try {
      const child = spawn(toolPath, ['--version'], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
      child.on('error', () => done(null))
      child.on('close', () => {
        const firstLine = out.split(/\r?\n/).find((l) => l.trim().length > 0)
        done(firstLine ? firstLine.trim().slice(0, 120) : null)
      })
      const timer = setTimeout(() => {
        child.kill()
        done(null)
      }, timeoutMs)
      child.on('close', () => clearTimeout(timer))
    } catch {
      done(null)
    }
  })
}

export async function detectTexEnvironment(): Promise<TexEnvironment> {
  const { paths, source } = await resolveSystemPath()
  const located = locateTools(paths, TOOL_NAMES)

  const tools: Partial<Record<TeXToolName, TexTool>> = {}
  for (const name of TOOL_NAMES) {
    const toolPath = located[name]
    if (!toolPath) continue
    const version = await readVersion(toolPath)
    tools[name] = { name, path: toolPath, version }
  }

  const available = Boolean(tools.latexmk && (tools.pdflatex || tools.xelatex || tools.lualatex))
  return { available, pathSource: source, tools }
}
