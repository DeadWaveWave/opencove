import { ipcRenderer } from 'electron'
import type { IpcChannel } from '../../shared/contracts/ipc'
import { createAppError, isIpcInvokeResult } from '../../shared/errors/appError'

export async function invokeIpc<TResult>(channel: IpcChannel): Promise<TResult>
export async function invokeIpc<TResult, TPayload>(
  channel: IpcChannel,
  payload: TPayload,
): Promise<TResult>
export async function invokeIpc<TResult>(channel: IpcChannel, payload?: unknown): Promise<TResult> {
  const result =
    arguments.length === 1
      ? await ipcRenderer.invoke(channel)
      : await ipcRenderer.invoke(channel, payload)

  if (isIpcInvokeResult<TResult>(result)) {
    if (result.ok) {
      return result.value
    }

    throw createAppError(result.error)
  }

  return result as TResult
}
