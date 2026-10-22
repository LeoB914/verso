import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, sanitizeProjectConfig } from '../../../src/main/project/config'

describe('project.json validation', () => {
  it('keeps valid values', () => {
    expect(
      sanitizeProjectConfig({ ...DEFAULT_CONFIG, mainFile: 'thesis.tex', compiler: 'lualatex' })
    ).toMatchObject({ mainFile: 'thesis.tex', compiler: 'lualatex' })
  })

  it('replaces invalid fields with defaults and keeps the rest', () => {
    const config = sanitizeProjectConfig({
      mainFile: 'thesis.tex',
      compiler: 'pdfLaTeX',
      autoCompile: 'yes',
      spellLanguage: 'fr',
    })
    expect(config).toEqual({ ...DEFAULT_CONFIG, mainFile: 'thesis.tex' })
  })

  it('ignores unknown keys and non-object input', () => {
    expect(sanitizeProjectConfig({ extra: 1 })).toEqual(DEFAULT_CONFIG)
    expect(sanitizeProjectConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(sanitizeProjectConfig([1, 2])).toEqual(DEFAULT_CONFIG)
  })
})
