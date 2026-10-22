import { describe, expect, it } from 'vitest'
import { findProseRanges } from '../../../src/shared/latex/spell-tokenizer'
import { parseStructure } from '../../../src/shared/latex/structure'

function words(text: string): string[] {
  const regions = parseStructure(text)
  return findProseRanges(text, regions.commentRanges, regions.verbatimRanges).map((r) => r.word)
}

describe('spell tokenizer', () => {
  it('finds plain prose words', () => {
    expect(words('Hello wonderful world.')).toEqual(['Hello', 'wonderful', 'world'])
  })

  it('keeps hyphenated and apostrophe words', () => {
    expect(words('well-known LaTeX’s world')).toEqual(['well-known', 'LaTeX’s', 'world'])
  })

  it('skips commands and their non-text arguments', () => {
    const text = '\\label{sec:foo} \\ref{sec:foo} \\usepackage{amsmath} real words here'
    expect(words(text)).toEqual(['real', 'words', 'here'])
  })

  it('checks text inside styling commands', () => {
    expect(words('\\textbf{Bold words} here')).toEqual(['Bold', 'words', 'here'])
  })

  it('skips math', () => {
    expect(words('Before $x^2 + y_1$ after')).toEqual(['Before', 'after'])
  })

  it('skips comments', () => {
    expect(words('visible text % misspeled comment')).toEqual(['visible', 'text'])
  })

  it('skips verbatim', () => {
    expect(words('\\begin{verbatim}mispeled\\end{verbatim} fine')).toEqual(['fine'])
  })

  it('handles escaped percent', () => {
    expect(words('100\\% correct words')).toEqual(['correct', 'words'])
  })
})
