import { toAppErrorDescriptor } from '../../../shared/errors/appError'
import type {
  ControlSurfaceInvokeRequest,
  ControlSurfaceInvokeResult,
} from '../../../shared/contracts/controlSurface'
import type { ControlSurfaceContext, ControlSurfaceHandler } from './types'

export interface ControlSurface {
  register: <TPayload, TResult>(
    id: string,
    handler: ControlSurfaceHandler<TPayload, TResult>,
  ) => void
  invoke: (
    ctx: ControlSurfaceContext,
    request: ControlSurfaceInvokeRequest,
  ) => Promise<ControlSurfaceInvokeResult<unknown>>
}

export function createControlSurface(): ControlSurface {
  const handlers = new Map<string, ControlSurfaceHandler<unknown, unknown>>()

  return {
    register: (id, handler) => {
      if (handlers.has(id)) {
        throw new Error(`Control surface handler already registered: ${id}`)
      }

      handlers.set(id, handler as ControlSurfaceHandler<unknown, unknown>)
    },
    invoke: async (ctx, request) => {
      const handler = handlers.get(request.id)
      if (!handler || handler.kind !== request.kind) {
        return {
          __opencoveControlEnvelope: true,
          ok: false,
          error: toAppErrorDescriptor(
            new Error(`Unknown control surface ${request.kind}: ${request.id}`),
            'common.invalid_input',
          ),
        }
      }

      try {
        const payload = handler.validate(request.payload)
        const value = await handler.handle(ctx, payload)

        return {
          __opencoveControlEnvelope: true,
          ok: true,
          value,
        }
      } catch (error) {
        return {
          __opencoveControlEnvelope: true,
          ok: false,
          error: toAppErrorDescriptor(error, handler.defaultErrorCode),
        }
      }
    },
  }
}
