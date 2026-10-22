import type {
  EventChannel,
  EventContract,
  IpcChannel,
  IpcRequest,
  IpcResult,
  IpcResponse,
} from '@shared/ipc'

/**
 * Thin typed wrapper around the preload bridge.
 */
export const api = {
  invoke: <C extends IpcChannel>(
    channel: C,
    input: IpcRequest<C>
  ): Promise<IpcResult<IpcResponse<C>>> => {
    return window.openleaf.invoke(channel, input)
  },
  on: <C extends EventChannel>(
    channel: C,
    listener: (payload: EventContract[C]) => void
  ): (() => void) => {
    return window.openleaf.on(channel, listener)
  },
}

/** Invoke and throw on error results — for flows that surface via toasts. */
export async function invokeOrThrow<C extends IpcChannel>(
  channel: C,
  input: IpcRequest<C>
): Promise<IpcResponse<C>> {
  const result = await api.invoke(channel, input)
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}
