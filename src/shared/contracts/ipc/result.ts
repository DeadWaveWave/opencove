import type { AppErrorDescriptor } from '../dto'

export interface IpcSuccessResult<T> {
  __opencoveIpcEnvelope: true
  ok: true
  value: T
}

export interface IpcFailureResult {
  __opencoveIpcEnvelope: true
  ok: false
  error: AppErrorDescriptor
}

export type IpcInvokeResult<T> = IpcSuccessResult<T> | IpcFailureResult
