import type { AppErrorDescriptor } from '../dto'

export interface ControlSurfaceSuccessResult<T> {
  __opencoveControlEnvelope: true
  ok: true
  value: T
}

export interface ControlSurfaceFailureResult {
  __opencoveControlEnvelope: true
  ok: false
  error: AppErrorDescriptor
}

export type ControlSurfaceInvokeResult<T> =
  | ControlSurfaceSuccessResult<T>
  | ControlSurfaceFailureResult
