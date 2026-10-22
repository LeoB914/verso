/**
 * Reference updater (pure): when a .tex file or image is renamed/moved,
 * compute the textual changes needed for \\input/\\include/\\includegraphics/
 * \\bibliography/\\addbibresource references across the project.
 */

import { parseStructure, type ReferenceUse } from './structure'

export interface ReferenceUpdate {
  relPath: string
  line: number
  /** Old reference argument as written. */
  oldKey: string
  newKey: string
  message: string
}

export interface FileContentMap {
  /** relPath → file text */
  [relPath: string]: string
}

/** Candidate keys that could reference `relPath` (with and without extension). */
function candidateKeys(relPath: string): string[] {
  const withoutExt = relPath.replace(/\.(tex|pdf|png|jpg|jpeg|gif|eps|svg|bib)$/i, '')
  return [relPath, withoutExt].filter((k) => k.length > 0)
}

function normalizeKey(key: string): string {
  return key.replace(/^\.\//, '').replace(/\\/g, '/')
}

/**
 * Find all references that point to `relPath` and compute updated keys.
 * `newRelPath` is the new location of the file.
 */
export function computeReferenceUpdates(
  files: FileContentMap,
  oldRelPath: string,
  newRelPath: string
): ReferenceUpdate[] {
  const updates: ReferenceUpdate[] = []
  const candidates = new Set(candidateKeys(oldRelPath).map(normalizeKey))

  for (const [relPath, content] of Object.entries(files)) {
    const structure = parseStructure(content)
    const relevant: ReferenceUse[] = structure.references.filter((r) =>
      ['input', 'includegraphics', 'bibliography', 'bibresource'].includes(r.kind)
    )
    for (const ref of relevant) {
      if (!candidates.has(normalizeKey(ref.key))) continue
      // Compute the new key: keep extension style of the old key.
      let newKey: string
      if (normalizeKey(ref.key) === normalizeKey(oldRelPath)) {
        newKey = newRelPath
      } else {
        // Old key had no extension → new key without extension too.
        newKey = newRelPath.replace(/\.(tex|pdf|png|jpg|jpeg|gif|eps|svg|bib)$/i, '')
      }
      updates.push({
        relPath,
        line: ref.line,
        oldKey: ref.key,
        newKey,
        message: `${ref.command}{${ref.key}} → ${ref.command}{${newKey}}`,
      })
    }
  }
  return updates
}

/** Apply the updates to the file map (pure), returning a new map. */
export function applyReferenceUpdates(
  files: FileContentMap,
  updates: ReferenceUpdate[]
): FileContentMap {
  const result: FileContentMap = { ...files }
  // Group per file, apply from the last line to the first to keep offsets stable.
  const byFile = new Map<string, ReferenceUpdate[]>()
  for (const update of updates) {
    const list = byFile.get(update.relPath) ?? []
    list.push(update)
    byFile.set(update.relPath, list)
  }
  for (const [relPath, fileUpdates] of byFile) {
    let content = result[relPath]
    if (content === undefined) continue
    const sorted = [...fileUpdates].sort((a, b) => b.line - a.line)
    for (const update of sorted) {
      content = content.replace(
        new RegExp(
          `(\\\\(?:input|include|subfile|includegraphics|bibliography|addbibresource)\\s*\\{)(${escapeRegex(update.oldKey)})(\\})`,
          'g'
        ),
        `$1${escapeReplacement(update.newKey)}$3`
      )
    }
    result[relPath] = content
  }
  return result
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeReplacement(text: string): string {
  return text.replace(/\$/g, '$$$$')
}
