import type { FileNode } from './ipc'

/**
 * Find `main.tex` anywhere in the project tree (root files naturally win
 * because they are visited first). Used to open the document automatically
 * when a project is opened.
 */
export function findMainTex(tree: FileNode | null): string | null {
  if (!tree) return null
  if (tree.type === 'file' && tree.name.toLowerCase() === 'main.tex') return tree.relPath
  for (const child of tree.children ?? []) {
    const found = findMainTex(child)
    if (found) return found
  }
  return null
}
