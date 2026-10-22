import { ipcMain } from 'electron'
import { ZodError, type ZodType } from 'zod'
import { AppError } from '../util/errors'
import {
  ipcSchemas,
  type IpcChannel,
  type IpcHandler,
  type IpcRequest,
  type IpcResult,
  type IpcResponse,
} from '@shared/ipc'
import { PathSafetyError } from '../util/paths'

/**
 * Register a single IPC handler with zod validation of the incoming payload
 * and a guaranteed `{ ok, data } | { ok, error }` result shape.
 */
export function handleIpc<C extends IpcChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (_event, rawInput: unknown): Promise<IpcResult<IpcResponse<C>>> => {
    try {
      const schema = ipcSchemas[channel] as unknown as ZodType<IpcRequest<C>>
      const input = schema.parse(rawInput)
      const data = (await handler(input)) as IpcResponse<C>
      return { ok: true, data }
    } catch (err) {
      if (err instanceof ZodError) {
        return {
          ok: false,
          error: {
            code: 'invalid-request',
            message: `Invalid request for ${channel}: ${err.issues.map((i) => i.message).join(', ')}`,
          },
        }
      }
      const message = err instanceof Error ? err.message : String(err)
      const code =
        err instanceof PathSafetyError
          ? 'path-safety'
          : err instanceof AppError
            ? err.code
            : 'internal'
      return { ok: false, error: { code, message } }
    }
  })
}
