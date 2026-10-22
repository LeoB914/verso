/**
 * Registry of active chat streams: `stopChatStream` must abort the underlying
 * request (not just stop forwarding tokens). Kept separately from the AI SDK
 * so it can be unit-tested without a provider.
 */

const activeStreams = new Map<string, () => void>()

export function registerStream(sessionId: string, abort: () => void): void {
  activeStreams.set(sessionId, abort)
}

export function finishStream(sessionId: string): void {
  activeStreams.delete(sessionId)
}

export function hasActiveStream(sessionId: string): boolean {
  return activeStreams.has(sessionId)
}

/** Abort and forget the stream. Returns true when a stream was stopped. */
export function stopStream(sessionId: string): boolean {
  const abort = activeStreams.get(sessionId)
  if (!abort) return false
  activeStreams.delete(sessionId)
  abort()
  return true
}
