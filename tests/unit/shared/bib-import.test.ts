import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { arxivAtomToBibtex, classifyBibIdentifier } from '@shared/latex/bib-import'

describe('classifyBibIdentifier', () => {
  it('recognises arXiv ids, prefixes and URLs', () => {
    expect(classifyBibIdentifier('1706.03762')).toEqual({ kind: 'arxiv', id: '1706.03762' })
    expect(classifyBibIdentifier('arXiv:1706.03762v5')).toEqual({ kind: 'arxiv', id: '1706.03762' })
    expect(classifyBibIdentifier('https://arxiv.org/abs/1706.03762')).toEqual({
      kind: 'arxiv',
      id: '1706.03762',
    })
    expect(classifyBibIdentifier('https://arxiv.org/pdf/2301.12345v2.pdf')).toEqual({
      kind: 'arxiv',
      id: '2301.12345',
    })
  })

  it('keeps DOIs that contain year.number segments as DOIs', () => {
    expect(classifyBibIdentifier('10.1016/j.jcp.2020.109876')).toEqual({
      kind: 'doi',
      doi: '10.1016/j.jcp.2020.109876',
    })
    expect(classifyBibIdentifier('10.1080/00222895.2019.1234567')?.kind).toBe('doi')
    expect(classifyBibIdentifier('https://doi.org/10.1038/nature14539')).toEqual({
      kind: 'doi',
      doi: '10.1038/nature14539',
    })
    expect(classifyBibIdentifier('doi:10.1038/nature14539')).toEqual({
      kind: 'doi',
      doi: '10.1038/nature14539',
    })
  })

  it('recognises ISBN-10 and ISBN-13 with separators', () => {
    expect(classifyBibIdentifier('978-3-16-148410-0')).toEqual({
      kind: 'isbn',
      isbn: '9783161484100',
    })
    expect(classifyBibIdentifier('0-306-40615-2')).toEqual({ kind: 'isbn', isbn: '0306406152' })
  })

  it('returns null for empty input', () => {
    expect(classifyBibIdentifier('   ')).toBeNull()
  })
})

describe('arxivAtomToBibtex', () => {
  const xml = readFileSync(join(__dirname, '../../fixtures/arxiv-1706.03762.xml'), 'utf8')

  it('uses the entry title, not the feed title', () => {
    const result = arxivAtomToBibtex(xml, '1706.03762')
    expect(result?.bibtex).toContain('title = {Attention Is All You Need}')
    expect(result?.bibtex).not.toMatch(/arXiv Query/i)
  })

  it('lists every author and the publication year', () => {
    const result = arxivAtomToBibtex(xml, '1706.03762')
    expect(result?.key).toBe('arXiv170603762')
    expect(result?.bibtex).toMatch(/author = \{Ashish Vaswani and .* and Illia Polosukhin\}/)
    expect(result?.bibtex).toContain('year = {2017}')
  })

  it('returns null when the feed has no entry', () => {
    expect(arxivAtomToBibtex('<feed><title>arXiv Query</title></feed>', '1234.5678')).toBeNull()
  })
})
