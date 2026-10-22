import { describe, expect, it } from 'vitest'
import { buildSearchRegex, replaceInText, searchInText } from '../../../src/shared/search'

describe('buildSearchRegex', () => {
  it('escapes plain queries', () => {
    const regex = buildSearchRegex('a.b', { caseSensitive: false, wholeWord: false, regex: false })
    expect(regex!.test('xa.bx')).toBe(true)
    expect(regex!.test('axbx')).toBe(false)
  })

  it('supports case sensitivity', () => {
    const ci = buildSearchRegex('TeX', { caseSensitive: false, wholeWord: false, regex: false })
    const cs = buildSearchRegex('TeX', { caseSensitive: true, wholeWord: false, regex: false })
    expect(ci!.test('tex')).toBe(true)
    expect(cs!.test('tex')).toBe(false)
  })

  it('supports whole word', () => {
    const regex = buildSearchRegex('cat', { caseSensitive: false, wholeWord: true, regex: false })
    expect(regex!.test('a cat here')).toBe(true)
    expect(regex!.test('category')).toBe(false)
  })

  it('rejects invalid regex', () => {
    expect(
      buildSearchRegex('([', { caseSensitive: false, wholeWord: false, regex: true })
    ).toBeNull()
  })
})

describe('searchInText', () => {
  it('returns line, column and preview', () => {
    const text = 'one\ntwo three two\nfour'
    const matches = searchInText(
      text,
      buildSearchRegex('two', { caseSensitive: false, wholeWord: false, regex: false })!
    )
    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ line: 2, column: 1, length: 3 })
    expect(matches[1]).toMatchObject({ line: 2, column: 11 })
    expect(matches[0].preview).toBe('two three two')
  })
})

describe('replaceInText', () => {
  it('replaces all occurrences and counts them', () => {
    const { text, count } = replaceInText(
      'a b a b',
      buildSearchRegex('a', { caseSensitive: false, wholeWord: true, regex: false })!,
      'x'
    )
    expect(text).toBe('x b x b')
    expect(count).toBe(2)
  })
})
