import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy } from '../../../src/main/csp'

function directive(csp: string, name: string): string {
  return csp.split('; ').find((part) => part.startsWith(`${name} `)) ?? ''
}

describe('content security policy', () => {
  it('allows scripts only from the app bundle in production', () => {
    const csp = buildContentSecurityPolicy(undefined)
    expect(directive(csp, 'script-src')).toBe("script-src 'self'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toMatch(/https?:|ws:/)
    expect(directive(csp, 'object-src')).toBe("object-src 'none'")
  })

  it('adds the dev server, its websocket and inline scripts only in development', () => {
    const csp = buildContentSecurityPolicy('http://localhost:5173')
    expect(directive(csp, 'script-src')).toBe(
      "script-src 'self' 'unsafe-inline' http://localhost:5173 ws://localhost:5173"
    )
    expect(directive(csp, 'connect-src')).toContain('ws://localhost:5173')
    expect(csp).not.toContain('unsafe-eval')
  })
})
