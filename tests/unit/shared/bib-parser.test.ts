import { describe, expect, it } from 'vitest'
import { parseBibFile } from '@shared/latex/bib-parser'

describe('parseBibFile line numbers', () => {
  it('records the 1-based start line of each entry', () => {
    const content = [
      '% header',
      '@article{first,',
      '  title = {One},',
      '}',
      '',
      '@book{second,',
      '  title = {Two},',
      '}',
    ].join('\n')
    const entries = parseBibFile(content)
    expect(entries.map((entry) => entry.key)).toEqual(['first', 'second'])
    expect(entries[0].line).toBe(2)
    expect(entries[1].line).toBe(6)
  })
})
