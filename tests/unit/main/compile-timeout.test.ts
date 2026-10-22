import { describe, expect, it } from 'vitest'
import { resolveCompileTimeout } from '../../../src/main/ipc/handlers'

describe('resolveCompileTimeout', () => {
  it('uses the configured timeout', () => {
    expect(resolveCompileTimeout({ compileTimeoutMs: 10_000 })).toBe(10_000)
    expect(resolveCompileTimeout({ compileTimeoutMs: 300_000 })).toBe(300_000)
  })

  it('falls back to 120 s', () => {
    expect(resolveCompileTimeout({})).toBe(120_000)
  })

  it('clamps to the schema range', () => {
    expect(resolveCompileTimeout({ compileTimeoutMs: 1 })).toBe(10_000)
    expect(resolveCompileTimeout({ compileTimeoutMs: 99_999_999 })).toBe(600_000)
  })
})
