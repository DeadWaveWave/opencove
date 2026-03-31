import type { AppErrorCode } from '../../../shared/contracts/dto'
import type { ControlSurfaceOperationKind } from '../../../shared/contracts/controlSurface'

export interface ControlSurfaceContext {
  readonly now: () => Date
  readonly capabilities: {
    webShell: boolean
    sync: {
      state: boolean
      events: boolean
    }
  }
}

export type ControlSurfacePayloadValidator<TPayload> = (payload: unknown) => TPayload

export interface ControlSurfaceHandler<TPayload, TResult> {
  kind: ControlSurfaceOperationKind
  validate: ControlSurfacePayloadValidator<TPayload>
  handle: (ctx: ControlSurfaceContext, payload: TPayload) => Promise<TResult> | TResult
  defaultErrorCode: AppErrorCode
}
