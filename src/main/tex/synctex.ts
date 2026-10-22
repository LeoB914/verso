import { spawn } from 'node:child_process'
import * as path from 'node:path'
import {
  parseSynctexEdit,
  parseSynctexView,
  type SynctexEditResult,
  type SynctexViewResult,
} from '@shared/latex/synctex'
import { PathSafetyError, resolveInProject } from '../util/paths'
import { getCurrentProject, getTexEnvironment } from '../ipc/handlers'

/**
 * SyncTeX wrapper around the `synctex` CLI (spawn with arg arrays).
 */

function runSynctex(args: string[], timeoutMs = 10_000): Promise<{ code: number; output: string }> {
  const env = getTexEnvironment()
  const synctex = env?.tools.synctex
  if (!synctex) return Promise.resolve({ code: -1, output: 'synctex not found' })

  return new Promise((resolve) => {
    const child = spawn(synctex.path, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, output: 'synctex timed out' })
    }, timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, output: 'synctex failed to start' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
  })
}

/** Source → PDF: locate the PDF position for a source file+line. */
export async function synctexForward(
  relPath: string,
  line: number,
  column: number
): Promise<SynctexViewResult | null> {
  const project = getCurrentProject()
  if (!project) return null
  const env = getTexEnvironment()
  if (!env?.tools.synctex || !project.info.config.mainFile) return null

  const mainBase = path.basename(
    project.info.config.mainFile,
    path.extname(project.info.config.mainFile)
  )
  const pdfPath = path.join('.openleaf', 'build', mainBase + '.pdf')
  let pdfAbs: string
  let fileAbs: string
  try {
    pdfAbs = await resolveInProject(project.root, pdfPath)
    fileAbs = await resolveInProject(project.root, relPath)
  } catch (err) {
    if (err instanceof PathSafetyError) return null
    throw err
  }

  const { code, output } = await runSynctex([
    'view',
    '-i',
    `${line}:${column}:${fileAbs}`,
    '-o',
    pdfAbs,
  ])
  if (code !== 0 && !output.includes('Input:')) return null
  return parseSynctexView(output)
}

/** PDF → Source: locate the source position for a PDF page + point. */
export async function synctexBackward(
  page: number,
  x: number,
  y: number
): Promise<SynctexEditResult | null> {
  const project = getCurrentProject()
  if (!project) return null
  const env = getTexEnvironment()
  if (!env?.tools.synctex || !project.info.config.mainFile) return null

  const mainBase = path.basename(
    project.info.config.mainFile,
    path.extname(project.info.config.mainFile)
  )
  const pdfPath = path.join('.openleaf', 'build', mainBase + '.pdf')
  let pdfAbs: string
  try {
    pdfAbs = await resolveInProject(project.root, pdfPath)
  } catch (err) {
    if (err instanceof PathSafetyError) return null
    throw err
  }

  const { code, output } = await runSynctex(['edit', '-o', `${page}:${x}:${y}:${pdfAbs}`])
  if (code !== 0 && !output.includes('Input:')) return null
  const result = parseSynctexEdit(output)
  if (!result) return null
  // The CLI reports an absolute input path; the renderer works with
  // project-relative paths.
  return { ...result, file: path.relative(project.root, result.file) }
}
