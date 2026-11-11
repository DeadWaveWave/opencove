import { normalizeClientFeatures } from '../../../shared/contracts/controlSurface/clientFeatures'
import { assertGrantSpawnRoute } from './agentSpawnContext'
import { sessionGrantRule } from './http/sessionGrantPolicy'
import {
  sessionGrantAllowsOperation,
  sessionGrantDeniedError,
} from './http/sessionGrantAuthorization'
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
  hasOperation: (id: string) => boolean
  invoke: (
    ctx: ControlSurfaceContext,
    request: ControlSurfaceInvokeRequest,
  ) => Promise<ControlSurfaceInvokeResult<unknown>>
}

export function createControlSurface(
  options: {
    enter?: (id: string) => (() => void) | undefined
    run?: (
      ctx: ControlSurfaceContext,
      request: ControlSurfaceInvokeRequest,
      execute: (context?: ControlSurfaceContext) => Promise<unknown>,
      payload: unknown,
    ) => Promise<unknown>
  } = {},
): ControlSurface {
  const handlers = new Map<string, ControlSurfaceHandler<unknown, unknown>>()

  const surface: ControlSurface = {
    hasOperation: id => handlers.has(id),
    register: (id, handler) => {
      if (handlers.has(id)) {
        throw new Error(`Control surface handler already registered: ${id}`)
      }

      handlers.set(id, handler as ControlSurfaceHandler<unknown, unknown>)
    },
    invoke: async (ctx, request) => {
      if (
        ctx.requestAuth?.kind === 'session-grant' &&
        !sessionGrantAllowsOperation(request.id, ctx.requestAuth.grant.tier)
      ) {
        return {
          __opencoveControlEnvelope: true,
          ok: false,
          error: sessionGrantDeniedError(request.id, ctx.requestAuth.grant.tier),
        }
      }
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

      let leave: (() => void) | undefined
      try {
        ctx = {
          ...ctx,
          clientFeatures: normalizeClientFeatures(request.clientFeatures ?? ctx.clientFeatures),
        }
        leave = options.enter?.(request.id)
        ctx.assertActive?.()
        const payload = handler.validate(request.payload)
        if (ctx.requestAuth?.kind === 'session-grant') {
          const rule = sessionGrantRule(request.id)
          if (rule.access === 'constrained') {
            rule.check(payload, {
              grant: ctx.requestAuth.grant,
              wirePayload: request.payload,
              operationId: request.id,
            })
          }
        }
        assertGrantSpawnRoute(surface, ctx, request.id)
        const execute = async (context = ctx) => await handler.handle(context, payload)
        const value = options.run
          ? await options.run(ctx, request, execute, payload)
          : await execute()

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
      } finally {
        leave?.()
      }
    },
  }
  return surface
}
