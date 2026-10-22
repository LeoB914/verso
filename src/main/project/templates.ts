import { app } from 'electron'
import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import type { Compiler, TemplateInfo } from '@shared/ipc'
import { copyProjectFolder, defaultProjectDirectory } from './registry'

/**
 * Project templates: built-in ones ship in `resources/templates/<id>/`,
 * user templates live in `userData/templates/<id>/`.
 */

interface TemplateManifest {
  id: string
  name: string
  description: string
  mainFile: string
  compiler: Compiler
}

/**
 * Built-in templates ship in `resources/templates` next to the app code:
 * the repo root in dev, `out/main/..` in E2E launches and inside `app.asar`
 * when packaged. Never rely on `process.cwd()` — a Finder launch uses `/`.
 */
export function findBuiltInTemplatesDir(startDir: string): string | null {
  let dir = startDir
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'resources', 'templates')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Template ids are folder names; anything else (e.g. `..`) is rejected. */
export function isValidTemplateId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes('..')
}

/**
 * Recursive copy that also works when the source lives inside `app.asar`
 * (Electron's asar layer supports readdir/readFile, not every `fs.cp` path).
 */
export async function copyDirectory(source: string, target: string): Promise<void> {
  await fsPromises.mkdir(target, { recursive: true })
  for (const entry of await fsPromises.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) await copyDirectory(from, to)
    else if (entry.isFile()) await fsPromises.writeFile(to, await fsPromises.readFile(from))
  }
}

function templateDirs(): Array<{ dir: string; builtIn: boolean }> {
  const builtInDir =
    findBuiltInTemplatesDir(app.getAppPath()) ??
    path.join(app.getAppPath(), 'resources', 'templates')
  const userDataDir = path.join(app.getPath('userData'), 'templates')
  return [
    { dir: builtInDir, builtIn: true },
    { dir: userDataDir, builtIn: false },
  ]
}

function readManifest(dir: string): TemplateManifest | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8')) as TemplateManifest
  } catch {
    return null
  }
}

export function listTemplates(): TemplateInfo[] {
  const templates: TemplateInfo[] = []
  for (const { dir, builtIn } of templateDirs()) {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifest = readManifest(path.join(dir, entry.name))
      if (!manifest) continue
      templates.push({
        id: entry.name,
        name: manifest.name,
        description: manifest.description,
        mainFile: manifest.mainFile,
        compiler: manifest.compiler,
        builtIn,
      })
    }
  }
  return templates
}

/** Instantiate a template into `<parentDir>/<name>` and return the project path. */
export async function instantiateTemplate(
  templateId: string,
  name: string,
  parentDir?: string
): Promise<string | null> {
  if (!name || /[\\/]/.test(name) || !isValidTemplateId(templateId)) return null
  const targetDir = parentDir ?? defaultTemplateTarget()
  await fsPromises.mkdir(targetDir, { recursive: true })
  const projectPath = path.join(targetDir, name)
  if (fs.existsSync(projectPath)) return null

  for (const { dir, builtIn } of templateDirs()) {
    const sourceDir = path.join(dir, templateId)
    if (!builtIn) continue
    if (fs.existsSync(sourceDir)) {
      await copyDirectory(sourceDir, projectPath)
      return projectPath
    }
  }
  // User template.
  const userDir = path.join(app.getPath('userData'), 'templates', templateId)
  if (fs.existsSync(userDir)) {
    await copyDirectory(userDir, projectPath)
    return projectPath
  }
  return null
}

function defaultTemplateTarget(): string {
  return defaultProjectDirectory()
}

/** Save a project as a reusable user template (without build/git junk). */
export async function saveProjectAsTemplate(
  projectPath: string,
  name: string
): Promise<TemplateInfo | null> {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (!id) return null
  const userTemplatesDir = path.join(app.getPath('userData'), 'templates')
  const targetDir = path.join(userTemplatesDir, id)
  if (fs.existsSync(targetDir)) return null
  await fsPromises.mkdir(userTemplatesDir, { recursive: true })
  await copyProjectFolder(projectPath, targetDir)

  // Detect main file + compiler from the project config.
  let mainFile = 'main.tex'
  let compiler: Compiler = 'pdflatex'
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(projectPath, '.openleaf', 'project.json'), 'utf8')
    ) as {
      mainFile?: string
      compiler?: Compiler
    }
    if (config.mainFile) mainFile = config.mainFile
    if (config.compiler) compiler = config.compiler
  } catch {
    // Defaults are fine.
  }

  const manifest: TemplateManifest = {
    id,
    name,
    description: `User template from ${path.basename(projectPath)}`,
    mainFile,
    compiler,
  }
  await fsPromises.writeFile(
    path.join(targetDir, 'template.json'),
    JSON.stringify(manifest, null, 2)
  )
  return {
    id,
    name,
    description: manifest.description,
    mainFile,
    compiler,
    builtIn: false,
  }
}

export function deleteUserTemplate(templateId: string): void {
  if (!isValidTemplateId(templateId)) return
  const dir = path.join(app.getPath('userData'), 'templates', templateId)
  fs.rmSync(dir, { recursive: true, force: true })
}

export { copyProjectFolder }
