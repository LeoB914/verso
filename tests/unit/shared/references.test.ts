import { describe, expect, it } from 'vitest'
import {
  applyReferenceUpdates,
  computeReferenceUpdates,
} from '../../../src/shared/latex/references'

describe('computeReferenceUpdates', () => {
  const files = {
    'main.tex': [
      '\\documentclass{article}',
      '\\begin{document}',
      '\\input{sections/intro}',
      '\\includegraphics[width=\\linewidth]{figures/diagram}',
      '\\end{document}',
    ].join('\n'),
    'other.tex': '\\include{sections/intro}\n% nothing else',
  }

  it('finds all references to a renamed file (with and without extension)', () => {
    const updates = computeReferenceUpdates(files, 'sections/intro.tex', 'sections/old-intro.tex')
    expect(updates).toHaveLength(2)
    expect(updates.every((u) => u.newKey === 'sections/old-intro')).toBe(true)
  })

  it('finds image references', () => {
    const updates = computeReferenceUpdates(files, 'figures/diagram.pdf', 'figures/renamed.pdf')
    expect(updates).toHaveLength(1)
    // The old key had no extension, so the new key omits it too.
    expect(updates[0].newKey).toBe('figures/renamed')
    expect(updates[0].relPath).toBe('main.tex')
    expect(updates[0].line).toBe(4)
  })

  it('returns nothing for unrelated files', () => {
    expect(computeReferenceUpdates(files, 'figures/unrelated.png', 'figures/x.png')).toHaveLength(0)
  })
})

describe('applyReferenceUpdates', () => {
  const files = {
    'main.tex': '\\input{sections/intro}\n\\input{sections/intro}\n',
  }

  it('rewrites matching references', () => {
    const updates = computeReferenceUpdates(files, 'sections/intro.tex', 'sections/new.tex')
    const result = applyReferenceUpdates(files, updates)
    expect(result['main.tex']).toBe('\\input{sections/new}\n\\input{sections/new}\n')
  })

  it('leaves other files untouched', () => {
    const result = applyReferenceUpdates(files, [])
    expect(result['main.tex']).toBe(files['main.tex'])
  })
})
