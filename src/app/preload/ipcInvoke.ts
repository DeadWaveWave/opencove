import { ipcRenderer } from 'electron'
import type { IpcChannel } from '../../shared/contracts/ipc'
import { RendererTransportError } from '../../shared/errors/rendererTransportError'
import { toRendererAppErrorDescriptor } from '../../shared/errors/rendererAppError'
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

  if (
    isIpcInvokeResult<TResult>(result) &&
    Object.hasOwn(result, '__opencoveIpcEnvelope') &&
    Object.hasOwn(result, 'ok')
  ) {
    if (result.ok) {
      if (!Object.hasOwn(result, 'value')) {
        throw new RendererTransportError()
      }
      return result.value
    }

    const descriptor = toRendererAppErrorDescriptor(result.error)
    if (!descriptor) {
      throw new RendererTransportError()
    }
    throw createAppError(result.error)
  }

  throw new RendererTransportError()
}
