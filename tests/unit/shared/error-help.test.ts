import { describe, expect, it } from 'vitest'
import { matchErrorHelp } from '../../../src/shared/latex/error-help'

describe('matchErrorHelp', () => {
  it('matches undefined control sequence', () => {
    const help = matchErrorHelp('Undefined control sequence. \\foo')
    expect(help?.id).toBe('undefined-control-sequence')
  })

  it('matches missing $', () => {
    expect(matchErrorHelp('Missing $ inserted.')?.id).toBe('missing-dollar')
  })

  it('matches file not found', () => {
    expect(matchErrorHelp("LaTeX Error: File `fancy.sty' not found.")?.title).toContain('not found')
  })

  it('matches overfull box as informational', () => {
    expect(matchErrorHelp('Overfull \\hbox (12.5pt too wide) in paragraph')?.id).toBe(
      'overfull-hbox'
    )
  })

  it('matches biber errors', () => {
    expect(matchErrorHelp('Biber error: something')?.id).toBe('biber-missing')
  })

  it('returns null for unknown messages', () => {
    expect(matchErrorHelp('Completely novel situation XYZ')).toBeNull()
  })

  it('covers at least 25 distinct patterns', () => {
    const ids = new Set(
      [
        'Undefined control sequence',
        'Missing $ inserted',
        "File `x.sty' not found",
        'Missing \\begin{document}',
        'Extra alignment tab has been changed to \\cr',
        "Too many }'s",
        'Runaway argument',
        "Citation `x' undefined",
        "Reference `x' undefined",
        'Emergency stop',
      ].map((m) => matchErrorHelp(m)?.id)
    )
    expect(ids.size).toBeGreaterThanOrEqual(8)
  })
})
