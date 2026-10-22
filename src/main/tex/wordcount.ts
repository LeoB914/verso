import { spawn } from 'node:child_process'
import * as path from 'node:path'
import {
  parseTexcountBrief,
  parseTexcountVerbose,
  type TexcountResult,
} from '@shared/latex/texcount'
import { getCurrentProject, getTexEnvironment } from '../ipc/handlers'
import { resolveInProject } from '../util/paths'

/** Run texcount on the main file and parse the result. */
export async function runWordCount(): Promise<TexcountResult | null> {
  const project = getCurrentProject()
  const env = getTexEnvironment()
  if (!project || !project.info.config.mainFile || !env?.tools.texcount) return null

  let mainAbs: string
  try {
    mainAbs = await resolveInProject(project.root, project.info.config.mainFile)
  } catch {
    return null
  }

  return new Promise((resolve) => {
    const child = spawn(env.tools.texcount!.path, ['-inc', '-sum', '-utf8', '-brief', mainAbs], {
      cwd: path.dirname(mainAbs),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, 15_000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(parseTexcountBrief(output) ?? parseTexcountVerbose(output))
    })
  })
}
