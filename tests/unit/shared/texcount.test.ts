import { describe, expect, it } from 'vitest'
import { parseTexcountBrief, parseTexcountVerbose } from '../../../src/shared/latex/texcount'

describe('parseTexcountBrief', () => {
  it('parses multi-file brief output', () => {
    const output = ['1240+120+40:main.tex', '530+30+10:sections/intro.tex'].join('\n')
    const result = parseTexcountBrief(output)
    expect(result).not.toBeNull()
    expect(result!.words).toBe(1770)
    expect(result!.headers).toBe(150)
    expect(result!.captions).toBe(50)
    expect(result!.files).toHaveLength(2)
    expect(result!.files[1].file).toBe('sections/intro.tex')
  })

  it('returns null without matching lines', () => {
    expect(parseTexcountBrief('nothing here')).toBeNull()
  })
})

describe('parseTexcountVerbose', () => {
  it('parses verbose output blocks', () => {
    const output = [
      '_________________________________________',
      'Input marks: main.tex',
      'Words in text: 800',
      'Words in headers: 40',
      'Words outside text (captions, ...): 12',
      'Number of headers: 6',
    ].join('\n')
    const result = parseTexcountVerbose(output)
    expect(result).not.toBeNull()
    expect(result!.words).toBe(800)
    expect(result!.headers).toBe(40)
    expect(result!.captions).toBe(12)
  })
})
