import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { locateTools } from '../../../src/main/tex/detect'

// The app appends .exe and uses the platform separator on Windows.
const exe = (dir: string, name: string): string =>
  join(dir, name + (process.platform === 'win32' ? '.exe' : ''))

describe('locateTools', () => {
  const exists = (dir: string, name: string): boolean => dir === '/texbin' && name !== 'perl'

  it('finds the first tool in the first matching directory', () => {
    const found = locateTools(['/texbin', '/other'], ['latexmk', 'pdflatex'], exists)
    expect(found.latexmk).toBe(exe('/texbin', 'latexmk'))
    expect(found.pdflatex).toBe(exe('/texbin', 'pdflatex'))
  })

  it('returns undefined for tools that do not exist', () => {
    const found = locateTools(['/texbin'], ['perl'], exists)
    expect(found.perl).toBeUndefined()
  })

  it('prefers earlier directories in PATH order', () => {
    const orderExists = (dir: string, name: string): boolean =>
      dir === '/first' ? name === 'latexmk' : name === 'bibtex'
    const found = locateTools(['/first', '/second'], ['latexmk', 'bibtex'], orderExists)
    expect(found.latexmk).toBe(exe('/first', 'latexmk'))
    expect(found.bibtex).toBe(exe('/second', 'bibtex'))
  })
})
