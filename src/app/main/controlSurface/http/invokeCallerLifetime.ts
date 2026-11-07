import type { WebSessionManager } from './webSessionManager'
import type { ServerResponse } from 'node:http'
import type { ControlSurfaceContext } from '../types'
import type { RequestAuth } from './requestAuth'
import type { SessionGrantRegistry } from './sessionGrantRegistry'
import { createAppError } from '../../../../shared/errors/appError'

export function invokeCallerLifetime(
  ctx: ControlSurfaceContext,
  res: ServerResponse,
  auth: RequestAuth,
  grants?: SessionGrantRegistry,
  webSessions?: WebSessionManager,
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const cookieActive = () =>
    auth.kind !== 'cookie' ||
    (!!auth.webSessionCookie &&
      webSessions?.resolveCookieGeneration(ctx.now(), auth.webSessionCookie) ===
        auth.webSessionGeneration)
  const checkCookie = () => {
    if (!cookieActive()) {
      abort()
    }
  }
  const unsubscribeWeb = auth.kind === 'cookie' ? webSessions?.onInvalidate(checkCookie) : undefined
  const expiresAt =
    auth.kind === 'cookie' && auth.webSessionCookie
      ? webSessions?.cookieExpiresAt(auth.webSessionCookie)
      : undefined
  const expiryTimer =
    expiresAt === undefined
      ? undefined
      : setTimeout(abort, Math.max(0, expiresAt - ctx.now().getTime()))
  checkCookie()
  res.once('close', abort)
  ctx.signal?.addEventListener('abort', abort, { once: true })
  const unsubscribe =
    auth.kind === 'session-grant' ? grants?.onRevoke(auth.grant.grantId, abort) : undefined
  if (res.destroyed || ctx.signal?.aborted) {
    abort()
  }
  return {
    signal: controller.signal,
    assertActive: () => {
      ctx.assertActive?.()
      if (
        controller.signal.aborted ||
        !cookieActive() ||
        (auth.kind === 'session-grant' && !grants?.isActive(auth.grant.grantId))
      ) {
        throw createAppError('control_surface.unauthorized')
      }
    },
    dispose: () => {
      res.off('close', abort)
      ctx.signal?.removeEventListener('abort', abort)
      unsubscribe?.()
      unsubscribeWeb?.()
      if (expiryTimer !== undefined) {
        clearTimeout(expiryTimer)
      }
    },
  }
}
