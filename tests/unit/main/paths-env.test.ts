import { describe, expect, it } from 'vitest'
import {
  PATH_BEGIN,
  PATH_END,
  expandGlobs,
  parseShellPathOutput,
} from '../../../src/main/env/paths'

describe('parseShellPathOutput', () => {
  it('uses only the text between the sentinels', () => {
    const output = `Welcome back!\n${PATH_BEGIN}/a:/b${PATH_END}\nPS> `
    expect(parseShellPathOutput(output)).toEqual(['/a', '/b'])
  })

  it('works when the shell prints banners before and after', () => {
    const output = `motd line\n${PATH_BEGIN}/opt/custom/bin:/usr/bin${PATH_END}\nlogout`
    expect(parseShellPathOutput(output)).toEqual(['/opt/custom/bin', '/usr/bin'])
  })

  it('returns nothing without sentinels', () => {
    expect(parseShellPathOutput('/a:/b\n')).toEqual([])
  })

  it('drops empty entries', () => {
    expect(parseShellPathOutput(`${PATH_BEGIN}:/a::/b:${PATH_END}`)).toEqual(['/a', '/b'])
  })
})

describe('expandGlobs', () => {
  it('expands a POSIX texlive path', () => {
    const tree: Record<string, string[]> = {
      '/usr/local/texlive': ['2025', '2026', 'notes.txt'],
      '/usr/local/texlive/2026': ['bin'],
      '/usr/local/texlive/2026/bin': ['universal-darwin', 'arm64'],
    }
    const result = expandGlobs(['/usr/local/texlive/*/bin/*'], (dir) => tree[dir] ?? [])
    expect(result).toContain('/usr/local/texlive/2026/bin/universal-darwin')
    expect(result).toContain('/usr/local/texlive/2026/bin/arm64')
    expect(result.some((p) => p.includes('2025'))).toBe(false)
  })

  it('expands a Windows TeX Live path (any year)', () => {
    const tree: Record<string, string[]> = {
      'C:\\texlive': ['2024', '2026'],
      'C:\\texlive\\2026': ['bin'],
      'C:\\texlive\\2026\\bin': ['windows'],
    }
    const result = expandGlobs(['C:\\texlive\\*\\bin\\windows'], (dir) => tree[dir] ?? [])
    expect(result.some((p) => p.includes('2026') && p.endsWith('windows'))).toBe(true)
  })

  it('keeps paths without globs unchanged', () => {
    expect(expandGlobs(['/Library/TeX/texbin'], () => [])).toEqual(['/Library/TeX/texbin'])
  })
})
