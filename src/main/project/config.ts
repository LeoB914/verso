import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { z } from 'zod'
import { compilers, type Compiler, type ProjectConfig, type ProjectInfo } from '@shared/ipc'

const CONFIG_DIR = '.openleaf'
const CONFIG_FILE = 'project.json'
const BUILD_DIR = 'build'

export const DEFAULT_CONFIG: ProjectConfig = {
  mainFile: '',
  compiler: 'pdflatex' satisfies Compiler,
  shellEscape: false,
  spellLanguage: 'en',
  autoCompile: false,
  spellEnabled: true,
}

export function projectConfigPath(root: string): string {
  return path.join(root, CONFIG_DIR, CONFIG_FILE)
}

export function projectBuildDir(root: string): string {
  return path.join(root, CONFIG_DIR, BUILD_DIR)
}

/** Field validators; an invalid value falls back to its default, the rest is kept. */
const configFields = {
  mainFile: z.string(),
  compiler: z.enum(compilers),
  shellEscape: z.boolean(),
  spellLanguage: z.enum(['en', 'de']),
  autoCompile: z.boolean(),
  spellEnabled: z.boolean(),
} satisfies Record<keyof ProjectConfig, z.ZodType>

/** Validate a parsed project.json field by field (hand-edited files happen). */
export function sanitizeProjectConfig(raw: unknown): ProjectConfig {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const config: Record<string, unknown> = { ...DEFAULT_CONFIG }
  for (const [key, schema] of Object.entries(configFields)) {
    const result = schema.safeParse(input[key])
    if (result.success) config[key] = result.data
  }
  return config as unknown as ProjectConfig
}

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  try {
    const raw = (await fs.readFile(projectConfigPath(root), 'utf8')).replace(/^\uFEFF/, '')
    return sanitizeProjectConfig(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function writeProjectConfig(root: string, config: ProjectConfig): Promise<void> {
  const configPath = projectConfigPath(root)
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.mkdir(projectBuildDir(root), { recursive: true })
  const tmp = configPath + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, configPath)
}

export interface OpenProjectResult {
  info: ProjectInfo
  createdConfig: boolean
}

/**
 * Open (or re-open) a project folder: ensure `.openleaf/project.json` exists,
 * detect the main file if unset. `defaults` (from app settings) apply when the
 * config is created for the first time.
 */
export async function openProject(
  root: string,
  defaults?: Partial<ProjectConfig>
): Promise<OpenProjectResult> {
  const stat = await fs.stat(root)
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${root}`)

  let config = await readProjectConfig(root)
  let createdConfig = false
  try {
    await fs.access(projectConfigPath(root))
  } catch {
    createdConfig = true
    config = { ...DEFAULT_CONFIG, ...defaults, mainFile: config.mainFile }
  }
  if (config.mainFile === '') {
    config = { ...config, mainFile: await detectMainFile(root) }
  }
  await writeProjectConfig(root, config)

  const info: ProjectInfo = {
    path: root,
    name: path.basename(root),
    config,
  }
  return { info, createdConfig }
}

/**
 * Pick the main `.tex` file: prefer `main.tex`, then any root-level file
 * containing `\documentclass`, then any `.tex` containing it.
 */
export async function detectMainFile(root: string): Promise<string> {
  const texFiles = await collectTexFiles(root)
  if (texFiles.length === 0) return ''
  const mainTex = texFiles.find((f) => path.basename(f).toLowerCase() === 'main.tex')
  if (mainTex) return mainTex
  for (const file of texFiles) {
    if (await fileContainsDocumentClass(path.join(root, file))) return file
  }
  return texFiles[0] ?? ''
}

async function collectTexFiles(root: string): Promise<string[]> {
  const results: string[] = []
  const skip = new Set(['.openleaf', '.git', 'node_modules'])

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > 8) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath, depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.tex')) {
        results.push(relPath)
      }
    }
  }

  await walk(root, '', 0)
  // Root-level files first, then alphabetical.
  results.sort((a, b) => {
    const depthA = a.split('/').length
    const depthB = b.split('/').length
    if (depthA !== depthB) return depthA - depthB
    return a.localeCompare(b)
  })
  return results
}

async function fileContainsDocumentClass(absolute: string): Promise<boolean> {
  try {
    const content = await fs.readFile(absolute, 'utf8')
    return /\\documentclass\s*[[{]/.test(content)
  } catch {
    return false
  }
}
