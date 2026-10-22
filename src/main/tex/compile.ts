import { spawn } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { Compiler } from '@shared/ipc'

/**
 * latexmk runner. One compile at a time; a new request cancels the running
 * one. Long-running work never blocks the UI: the caller gets an event-driven
 * completion.
 */

export interface CompileRequest {
  /** Absolute path of latexmk. */
  latexmkPath: string
  compiler: Compiler
  /** Absolute path of the main .tex file. */
  mainFile: string
  /** Absolute output directory (`.openleaf/build`). */
  outDir: string
  /** Extra PATH entries for finding TeX binaries. */
  pathDirs: string[]
  shellEscape: boolean
  timeoutMs: number
  /** Recompile from scratch (latexmk -gg, invalidates all intermediate files). */
  fresh?: boolean
}

export interface CompileOutcome {
  code: number | null
  canceled: boolean
  timedOut: boolean
  /** Relative path (to project root) of the produced PDF, if one exists. */
  pdfPath: string | null
}

let running: { cancel: () => void } | null = null

/** Cancel a running compile, if any. */
export function cancelCompile(): boolean {
  if (running) {
    running.cancel()
    return true
  }
  return false
}

/** Kill the whole process tree of a detached child. */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { shell: false })
  } else {
    try {
      // Negative PID kills the detached process group.
      process.kill(-pid, 'SIGTERM')
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // Already gone.
        }
      }, 1500)
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }
}

function latexmkArgs(req: CompileRequest): string[] {
  const args: string[] = []
  if (req.fresh) args.push('-gg')
  switch (req.compiler) {
    case 'pdflatex':
      args.push('-pdf')
      break
    case 'xelatex':
      args.push('-xelatex')
      break
    case 'lualatex':
      args.push('-lualatex')
      break
  }
  args.push('-synctex=1', '-interaction=nonstopmode', '-file-line-error')
  if (req.shellEscape) args.push('-shell-escape')
  args.push(`-outdir=${req.outDir}`)
  args.push(req.mainFile)
  return args
}

export function compile(
  req: CompileRequest,
  onStdout?: (chunk: string) => void
): Promise<CompileOutcome> {
  // Only one compile at a time: cancel the running one.
  cancelCompile()

  return new Promise((resolve) => {
    const env = { ...process.env }
    const extraPath = req.pathDirs.join(path.delimiter)
    env.PATH = env.PATH ? env.PATH + path.delimiter + extraPath : extraPath
    // Keep TeX from wrapping log lines at 79 characters — wrapped
    // `file:line:` error prefixes would break log parsing.
    env.max_print_line = '4096'

    const args = latexmkArgs(req)
    const cwd = path.dirname(req.mainFile)

    const child = spawn(req.latexmkPath, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== 'win32', // own process group for tree-kill
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let canceled = false
    let timedOut = false
    let settled = false
    let stdoutBuf = ''

    const cancel = () => {
      canceled = true
      killTree(child.pid ?? -1)
    }
    running = { cancel }

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid ?? -1)
    }, req.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      if (stdoutBuf.length > 200_000) stdoutBuf = stdoutBuf.slice(-100_000)
      onStdout?.(chunk.toString())
    })
    child.stderr.on('data', (chunk: Buffer) => onStdout?.(chunk.toString()))

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      running = null
      resolve({ code, canceled, timedOut, pdfPath: null })
    }

    child.on('error', (err) => {
      onStdout?.(`\nFailed to start latexmk: ${err.message}\n`)
      finish(-1)
    })
    child.on('close', (code) => finish(code))

    void stdoutBuf
  })
}

/** Find the produced PDF in the outDir for a given main file. */
export async function findCompiledPdf(mainFile: string, outDir: string): Promise<string | null> {
  const base = path.basename(mainFile, path.extname(mainFile))
  const candidate = path.join(outDir, base + '.pdf')
  try {
    const stat = await fs.stat(candidate)
    return stat.isFile() ? candidate : null
  } catch {
    return null
  }
}
