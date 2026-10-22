import { describe, expect, it } from 'vitest'
import { findMainTex } from '@shared/project-files'
import type { FileNode } from '@shared/ipc'

function dir(relPath: string, children: FileNode[]): FileNode {
  return { name: relPath.split('/').pop() ?? relPath, relPath, type: 'dir', children }
}

function file(relPath: string): FileNode {
  return { name: relPath.split('/').pop() ?? relPath, relPath, type: 'file' }
}

describe('findMainTex', () => {
  it('returns null when no main.tex exists', () => {
    expect(findMainTex(dir('', [file('chapter.tex')]))).toBeNull()
    expect(findMainTex(null)).toBeNull()
  })

  it('finds main.tex at the root', () => {
    expect(findMainTex(dir('', [file('notes.tex'), file('main.tex')]))).toBe('main.tex')
  })

  it('finds main.tex inside a subfolder', () => {
    expect(findMainTex(dir('', [dir('doc', [file('doc/main.tex')])]))).toBe('doc/main.tex')
  })

  it('is case-insensitive', () => {
    expect(findMainTex(dir('', [file('Main.TeX')]))).toBe('Main.TeX')
  })
})
