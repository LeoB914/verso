import { describe, expect, it } from 'vitest'
import { htmlToLatex } from '@shared/latex/html-to-latex'

describe('htmlToLatex', () => {
  it('converts basic rich text', () => {
    expect(htmlToLatex('<h1>Title</h1><p>A <strong>bold</strong> word.</p>')).toBe(
      '\\section{Title}\n\nA \\textbf{bold} word.'
    )
  })

  it('converts lists and links', () => {
    const result = htmlToLatex(
      '<ul><li>One</li><li>See <a href="https://x.test">link</a></li></ul>'
    )
    expect(result).toContain('\\begin{itemize}')
    expect(result).toContain('\\item One')
    expect(result).toContain('\\href{https://x.test}{link}')
  })
})
