import { describe, expect, it } from 'vitest'
import { citationInsertion, isInsideCiteList } from '../../../src/shared/latex/citations'

describe('isInsideCiteList', () => {
  it('detects the cursor inside a key list', () => {
    expect(isInsideCiteList('\\cite{knuth1984}', 6)).toBe(true)
    expect(isInsideCiteList('\\cite{knuth1984}', 15)).toBe(true)
    expect(isInsideCiteList('\\cite{a, b}', 9)).toBe(true)
  })

  it('rejects positions outside the braces', () => {
    expect(isInsideCiteList('\\cite{a}', 0)).toBe(false)
    expect(isInsideCiteList('\\cite{a}', 8)).toBe(false)
    expect(isInsideCiteList('plain text', 5)).toBe(false)
  })

  it('handles other cite commands and starred variants', () => {
    expect(isInsideCiteList('\\parencite{a}', 12)).toBe(true)
    expect(isInsideCiteList('\\citep*{a}', 8)).toBe(true)
    expect(isInsideCiteList('\\textcite{a}', 11)).toBe(true)
  })
})

describe('citationInsertion', () => {
  it('inserts the full command at a plain cursor position', () => {
    const r = citationInsertion('Hello world.', 12, 'cite', 'knuth1984')
    expect(r).toEqual({ from: 12, to: 12, text: '\\cite{knuth1984}' })
  })

  it('uses the chosen command', () => {
    const r = citationInsertion('Some text ', 10, 'parencite', 'knuth1984')
    expect(r.text).toBe('\\parencite{knuth1984}')
  })

  it('appends with a comma in the middle of a key list', () => {
    const r = citationInsertion('\\cite{a, b}', 10, 'cite', 'c')
    expect(r.from).toBe(10)
    expect(r.text).toBe(',c')
    // Applying it yields \cite{a, b,c}
  })

  it('inserts a plain key right after a comma', () => {
    const r = citationInsertion('\\cite{a,}', 8, 'cite', 'b')
    expect(r.text).toBe('b')
  })

  it('inserts a plain key right after the opening brace', () => {
    const r = citationInsertion('\\cite{}', 6, 'cite', 'a')
    expect(r.text).toBe('a')
  })

  it('clamps out-of-range columns', () => {
    const r = citationInsertion('\\cite{a}', 99, 'cite', 'b')
    expect(r.from).toBe(8)
  })
})
