import { ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { AppErrorCode } from '../../../shared/contracts/dto'
import type { IpcChannel } from '../../../shared/contracts/ipc'
import type { IpcInvokeResult } from '../../../shared/contracts/ipc'
import { toAppErrorDescriptor } from '../../../shared/errors/appError'

export function registerHandledIpc<
  TResult,
  TPayload = undefined,
  TEvent extends IpcMainInvokeEvent | IpcMainEvent = IpcMainInvokeEvent,
>(
  channel: IpcChannel,
  handler: (event: TEvent, payload: TPayload) => Promise<TResult> | TResult,
  options: { defaultErrorCode: AppErrorCode },
): void {
  ipcMain.handle(channel, async (event, payload): Promise<IpcInvokeResult<TResult>> => {
    try {
      const value = await handler(event as TEvent, payload as TPayload)
      return {
        __opencoveIpcEnvelope: true,
        ok: true,
        value,
      }
    } catch (error) {
      return {
        __opencoveIpcEnvelope: true,
        ok: false,
        error: toAppErrorDescriptor(error, options.defaultErrorCode),
      }
    }
  })
}
