import { describe, expect, it } from 'vitest'
import { locateTools } from '../../../src/main/tex/detect'

describe('locateTools', () => {
  const exists = (dir: string, name: string): boolean => dir === '/texbin' && name !== 'perl'

  it('finds the first tool in the first matching directory', () => {
    const found = locateTools(['/texbin', '/other'], ['latexmk', 'pdflatex'], exists)
    expect(found.latexmk).toBe('/texbin/latexmk')
    expect(found.pdflatex).toBe('/texbin/pdflatex')
  })

  it('returns undefined for tools that do not exist', () => {
    const found = locateTools(['/texbin'], ['perl'], exists)
    expect(found.perl).toBeUndefined()
  })

  it('prefers earlier directories in PATH order', () => {
    const orderExists = (dir: string, name: string): boolean =>
      dir === '/first' ? name === 'latexmk' : name === 'bibtex'
    const found = locateTools(['/first', '/second'], ['latexmk', 'bibtex'], orderExists)
    expect(found.latexmk).toBe('/first/latexmk')
    expect(found.bibtex).toBe('/second/bibtex')
  })
})
