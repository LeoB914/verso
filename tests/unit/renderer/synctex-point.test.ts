import { describe, expect, it } from 'vitest'
import { pdfClickToSynctex } from '../../../src/renderer/pdf/synctex-point'

describe('pdfClickToSynctex', () => {
  it('converts CSS pixels to PDF points without flipping Y', () => {
    // A SyncTeX `view` result for line 6 of the fixture main.tex is
    // x=162.27, y=156.59 (top-left origin). Clicking that spot on a 2x page
    // must produce the same coordinates.
    const point = pdfClickToSynctex(324.545, 313.171, 2)
    expect(point.x).toBeCloseTo(162.2725, 6)
    expect(point.y).toBeCloseTo(156.5855, 6)
  })

  it('never divides by zero', () => {
    expect(pdfClickToSynctex(10, 20, 0)).toEqual({ x: 10, y: 20 })
  })
})
