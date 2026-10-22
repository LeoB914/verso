import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSynctexEdit, parseSynctexView } from '../../../src/shared/latex/synctex'

const viewOutput = `
This is SyncTeX command line version, 1.5
SyncTeX result begin
Output:/tmp/project/.openleaf/build/main.pdf
Input:./sections/intro.tex
Line:012
Column:0
Offset:0
Page:3
x:148.712997
y:668.111221
h:148.712997
v:669.517639
W:310.123457
H:10.909091
before:
offset:0
middle:
after:
SyncTeX result end
`

const editOutput = `
This is SyncTeX command line version, 1.5
SyncTeX result begin
Input:./main.tex
Line:00042
Column:000
Offset:12
Context:
SyncTeX result end
`

const fixtureDir = join(__dirname, '../../../tests/fixtures')

describe('parseSynctexView', () => {
  it('parses file, line, page and position', () => {
    const result = parseSynctexView(viewOutput)
    expect(result).not.toBeNull()
    expect(result!.file).toBe('sections/intro.tex')
    expect(result!.line).toBe(12)
    expect(result!.page).toBe(3)
    expect(result!.x).toBeCloseTo(148.712997)
    expect(result!.y).toBeCloseTo(668.111221)
    expect(result!.width).toBeCloseTo(310.123457)
  })
})

describe('parseSynctexEdit', () => {
  it('parses file and line', () => {
    const result = parseSynctexEdit(editOutput)
    expect(result).toEqual({ file: 'main.tex', line: 42, column: 0 })
  })

  it('returns null for garbage', () => {
    expect(parseSynctexView('no synctex data here')).toBeNull()
    expect(parseSynctexEdit('')).toBeNull()
  })
})

describe('synctex fixtures', () => {
  it('parses the bundled view fixture', () => {
    const output = readFileSync(join(fixtureDir, 'synctex-view.txt'), 'utf8')
    const result = parseSynctexView(output)
    expect(result).not.toBeNull()
    expect(result!.page).toBeGreaterThan(0)
  })

  it('parses real synctex 1.5 view output without Input/Line fields', () => {
    const output = readFileSync(join(fixtureDir, 'synctex-view-tl2026.txt'), 'utf8')
    const result = parseSynctexView(output)
    expect(result).not.toBeNull()
    expect(result!.file).toBeNull()
    expect(result!.line).toBeNull()
    expect(result!.page).toBe(2)
    expect(result!.x).toBeCloseTo(140.950043)
    expect(result!.y).toBeCloseTo(165.094254)
    expect(result!.width).toBeCloseTo(358.655029)
  })
})
