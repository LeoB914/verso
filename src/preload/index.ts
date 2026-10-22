import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  EventChannel,
  EventContract,
  IpcChannel,
  IpcRequest,
  IpcResult,
  IpcResponse,
} from '@shared/ipc'

/**
 * Typed, sandboxed preload. The renderer never touches Node APIs — everything
 * goes through this bridge with the central IPC contract.
 */

const api = {
  invoke: async <C extends IpcChannel>(
    channel: C,
    input: IpcRequest<C>
  ): Promise<IpcResult<IpcResponse<C>>> => {
    return (await ipcRenderer.invoke(channel, input)) as IpcResult<IpcResponse<C>>
  },
  on: <C extends EventChannel>(
    channel: C,
    listener: (payload: EventContract[C]) => void
  ): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: EventContract[C]): void =>
      listener(payload)
    ipcRenderer.on(channel, wrapped as never)
    return () => ipcRenderer.removeListener(channel, wrapped as never)
  },
  /** Resolve the absolute path of a File object from a drag & drop. */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
}

export type OpenLeafApi = typeof api

contextBridge.exposeInMainWorld('openleaf', api)
