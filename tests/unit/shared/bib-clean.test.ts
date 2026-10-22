import { describe, expect, it } from 'vitest'
import { cleanBib } from '@shared/latex/bib-clean'

describe('cleanBib', () => {
  it('sorts by key and removes duplicate keys', () => {
    const input = '@article{b, title={B}}\n@article{a, title={A}}\n@article{b, title={B2}}\n'
    const cleaned = cleanBib(input)
    expect(cleaned.indexOf('@article{a')).toBeLessThan(cleaned.indexOf('@article{b'))
    expect(cleaned.match(/@article\{b/g)).toHaveLength(1)
    expect(cleaned).toContain('B2')
  })
})
