import { describe, expect, it } from 'vitest'
import { canonicalizeRelativePath, isSafeRelativePath } from '../../../src/shared/paths'

describe('isSafeRelativePath', () => {
  it('accepts simple relative paths', () => {
    expect(isSafeRelativePath('main.tex')).toBe(true)
    expect(isSafeRelativePath('sections/intro.tex')).toBe(true)
    expect(isSafeRelativePath('a/b/c/deep/file.bib')).toBe(true)
  })

  it('accepts unicode and spaces', () => {
    expect(isSafeRelativePath('Kapitel Überschriften/tex file.tex')).toBe(true)
  })

  it('rejects empty paths', () => {
    expect(isSafeRelativePath('')).toBe(false)
  })

  it('rejects traversal', () => {
    expect(isSafeRelativePath('../secret.txt')).toBe(false)
    expect(isSafeRelativePath('a/../../b')).toBe(false)
    expect(isSafeRelativePath('..')).toBe(false)
  })

  it('rejects absolute POSIX paths', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
  })

  it('rejects Windows absolute paths and separators in traversal', () => {
    expect(isSafeRelativePath('C:\\Users\\evil')).toBe(false)
    expect(isSafeRelativePath('C:/Users/evil')).toBe(false)
    expect(isSafeRelativePath('\\\\server\\share')).toBe(false)
    expect(isSafeRelativePath('..\\secret.txt')).toBe(false)
    expect(isSafeRelativePath('a\\..\\..\\b')).toBe(false)
  })

  it('rejects NUL bytes', () => {
    expect(isSafeRelativePath('main\0.tex')).toBe(false)
  })
})

describe('canonicalizeRelativePath', () => {
  it('normalizes separators and dot segments', () => {
    expect(canonicalizeRelativePath('./a//b/')).toBe('a/b')
    expect(canonicalizeRelativePath('.\\sub\\file.tex')).toBe('sub/file.tex')
    expect(canonicalizeRelativePath('main.tex')).toBe('main.tex')
  })

  it('returns null for unsafe paths', () => {
    expect(canonicalizeRelativePath('../escape')).toBeNull()
    expect(canonicalizeRelativePath('/absolute')).toBeNull()
  })
})
