import { describe, expect, it } from 'vitest'
import {
  finishStream,
  hasActiveStream,
  registerStream,
  stopStream,
} from '../../../src/main/ai/stream-registry'

describe('chat stream cancellation', () => {
  it('aborts the underlying request signal when the stream is stopped', () => {
    const controller = new AbortController()
    registerStream('session-1', () => controller.abort())
    expect(controller.signal.aborted).toBe(false)
    expect(stopStream('session-1')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(hasActiveStream('session-1')).toBe(false)
  })

  it('is a no-op for unknown or finished sessions', () => {
    expect(stopStream('missing')).toBe(false)
    registerStream('session-2', () => undefined)
    finishStream('session-2')
    expect(hasActiveStream('session-2')).toBe(false)
    expect(stopStream('session-2')).toBe(false)
  })
})
