import * as path from 'node:path'
import { parseStructure } from '@shared/latex/structure'
import { readFileInProject } from './files'

export interface OutlineSection {
  title: string
  level: number
  line: number
  file: string
}

/** `\input{x}` / `\include{x}` on a non-commented line. */
const INCLUDE_RE = /^[ \t]*\\(?:input|include)\s*\{([^}]+)\}/gm

/**
 * Section outline of the project, following \input/\include recursively.
 * Sections of the including file come first, then the included files (the
 * structure parser has no cross-file ordering information).
 */
export async function collectOutline(root: string, mainFile: string): Promise<OutlineSection[]> {
  const sections: OutlineSection[] = []
  const visited = new Set<string>()

  const visit = async (relPath: string): Promise<void> => {
    if (visited.has(relPath)) return
    visited.add(relPath)
    let content: string
    try {
      content = (await readFileInProject(root, relPath)).content
    } catch {
      return
    }
    for (const section of parseStructure(content).sections) {
      sections.push({
        title: section.title,
        level: section.level,
        line: section.line,
        file: relPath,
      })
    }
    INCLUDE_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = INCLUDE_RE.exec(content)) !== null) {
      // Skip commented-out includes.
      const lineStart = content.lastIndexOf('\n', match.index) + 1
      if (content.slice(lineStart, match.index).includes('%')) continue
      let target = match[1].trim()
      if (!target) continue
      if (!path.extname(target)) target += '.tex'
      const dir = path.posix.dirname(relPath)
      // LaTeX resolves \input relative to the compile directory (project root);
      // fall back to the including file's folder for chapter-relative paths.
      const rootRelative = path.posix.normalize(target)
      const localRelative = path.posix.normalize(
        dir === '.' ? target : path.posix.join(dir, target)
      )
      const candidate = (await readFileInProject(root, rootRelative).catch(() => null))
        ? rootRelative
        : localRelative
      await visit(candidate)
    }
  }

  if (mainFile) await visit(mainFile)
  return sections
}
