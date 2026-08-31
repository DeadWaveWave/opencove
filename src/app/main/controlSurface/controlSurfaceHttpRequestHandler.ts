import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAppErrorDescriptor } from '../../../shared/errors/appError'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import type { ControlSurface } from './controlSurface'
import type { ControlSurfaceContext } from './types'
import { normalizeInvokeRequest } from './validate'
import { renderWorkerWebShellPage } from './workerWebShellPage'
import { tryResolveWebUiResponse } from './webUiAssets'
import type { WebSessionManager } from './http/webSessionManager'
import { readJsonBody, sendJson } from './http/httpJson'
import { resolveRequestAuth, type RequestAuth } from './http/requestAuth'
import { writeSseEvent, type SyncEventPayload } from './http/syncSse'
import { tryHandleWebAuthRoutes } from './http/webAuthRoutes'
import { gateWebUiEntrypoint } from './http/webUiEntryGate'
import { publishSyncEvent } from './http/publishSyncEvent'
import { shouldAllowDevWebUiOrigin } from './http/devWebUiOrigin'
import { buildUnauthorizedResult } from './http/unauthorizedResult'
import type {
  ControlSurfaceHttpListenerOptions,
  ControlSurfaceWebAccessPolicy,
} from './controlSurfaceHttpRuntime.contract'

const MAX_SYNC_EVENT_BUFFER = 256

export interface ControlSurfaceHttpRequestHandlerDeps {
  ctx: ControlSurfaceContext
  token: string
  webSessions: WebSessionManager
  controlSurface: ControlSurface
  getPersistenceStore: () => Promise<PersistenceStore>
  syncClients: Set<ServerResponse>
  syncEventBuffer: SyncEventPayload[]
  desktopSyncEventSink?: (payload: SyncEventPayload) => number
  getWebAccessPolicy: () => ControlSurfaceWebAccessPolicy
  isRuntimeClosed: () => boolean
}

function listenerAllowsAuth(
  role: ControlSurfaceHttpListenerOptions['role'],
  auth: RequestAuth,
): boolean {
  if (role === 'private') {
    return auth.kind === 'bearer' || auth.kind === 'query_token'
  }

  return true
}

function listenerServesWeb(role: ControlSurfaceHttpListenerOptions['role']): boolean {
  return role === 'combined' || role === 'web'
}

function requiresPrivateBearer(operationId: string): boolean {
  return operationId.startsWith('worker.')
}

function sendForbidden(res: ServerResponse): void {
  sendJson(res, 403, {
    __opencoveControlEnvelope: true,
    ok: false,
    error: createAppErrorDescriptor('control_surface.unauthorized'),
  })
}

export function createControlSurfaceHttpRequestHandler(
  deps: ControlSurfaceHttpRequestHandlerDeps,
): (input: {
  req: IncomingMessage
  res: ServerResponse
  listener: ControlSurfaceHttpListenerOptions
  listenerSyncClients: Set<ServerResponse>
}) => Promise<void> {
  return async ({ req, res, listener, listenerSyncClients }) => {
    if (deps.isRuntimeClosed()) {
      res.statusCode = 503
      res.end()
      return
    }

    if (!req.url) {
      res.statusCode = 400
      res.end()
      return
    }

    const url = new URL(req.url, 'http://localhost')
    const servesWeb = listenerServesWeb(listener.role)

    if (
      servesWeb &&
      (await tryHandleWebAuthRoutes({
        req,
        res,
        url,
        now: deps.ctx.now,
        webSessions: deps.webSessions,
        webUiPasswordHash: listener.webUiPasswordHash,
      }))
    ) {
      return
    }

    if (req.method === 'GET') {
      if (
        servesWeb &&
        gateWebUiEntrypoint({
          req,
          res,
          url,
          token: deps.token,
          webSessions: deps.webSessions,
          enableWebShell: listener.enableWebShell,
          webUiPasswordHash: listener.webUiPasswordHash,
          now: deps.ctx.now(),
        })
      ) {
        return
      }

      if (servesWeb && listener.enableWebShell && url.pathname === '/debug/shell') {
        const host = typeof req.headers.host === 'string' ? req.headers.host : ''
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(renderWorkerWebShellPage({ host }))
        return
      }

      const webUiResponse =
        servesWeb &&
        listener.enableWebShell &&
        url.pathname !== '/events' &&
        !url.pathname.startsWith('/auth/')
          ? tryResolveWebUiResponse(url.pathname, {
              allowDevOrigin: shouldAllowDevWebUiOrigin(
                typeof req.headers.host === 'string' ? req.headers.host : null,
              ),
            })
          : null

      if (webUiResponse) {
        res.statusCode = webUiResponse.statusCode
        res.setHeader('content-type', webUiResponse.contentType)
        res.end(webUiResponse.body)
        return
      }

      if (url.pathname === '/events') {
        const auth = resolveRequestAuth({
          req,
          url,
          token: deps.token,
          webSessions: deps.webSessions,
          allowQueryToken: true,
          now: deps.ctx.now(),
        })
        if (!auth || !listenerAllowsAuth(listener.role, auth)) {
          sendJson(res, 401, buildUnauthorizedResult())
          return
        }

        const afterRevisionRaw =
          url.searchParams.get('afterRevision') ??
          (req.headers['last-event-id'] as string | undefined)
        const afterRevisionParsed =
          typeof afterRevisionRaw === 'string' ? Number.parseInt(afterRevisionRaw, 10) : NaN
        const afterRevision =
          Number.isFinite(afterRevisionParsed) && afterRevisionParsed >= 0
            ? afterRevisionParsed
            : null

        res.statusCode = 200
        res.setHeader('content-type', 'text/event-stream; charset=utf-8')
        res.setHeader('cache-control', 'no-cache, no-transform')
        res.setHeader('connection', 'keep-alive')
        res.setHeader('x-accel-buffering', 'no')
        res.write(':\n\n')

        if (
          afterRevision !== null &&
          deps.syncEventBuffer.length > 0 &&
          afterRevision < deps.syncEventBuffer[0].revision - 1
        ) {
          try {
            const store = await deps.getPersistenceStore()
            writeSseEvent(res, {
              type: 'resync_required',
              revision: await store.readAppStateRevision(),
            })
          } catch {
            // ignore
          }
        } else if (afterRevision !== null && deps.syncEventBuffer.length > 0) {
          for (const payload of deps.syncEventBuffer) {
            if (payload.revision <= afterRevision) {
              continue
            }
            try {
              writeSseEvent(res, payload)
            } catch {
              break
            }
          }
        }

        deps.syncClients.add(res)
        listenerSyncClients.add(res)
        req.on('close', () => {
          deps.syncClients.delete(res)
          listenerSyncClients.delete(res)
        })
        return
      }
    }

    if (req.method !== 'POST' || req.url !== '/invoke') {
      res.statusCode = 404
      res.end()
      return
    }

    const auth = resolveRequestAuth({
      req,
      url,
      token: deps.token,
      webSessions: deps.webSessions,
      allowQueryToken: false,
      now: deps.ctx.now(),
    })
    if (!auth || !listenerAllowsAuth(listener.role, auth)) {
      sendJson(res, 401, buildUnauthorizedResult())
      return
    }

    try {
      const request = normalizeInvokeRequest(await readJsonBody(req))
      if (
        requiresPrivateBearer(request.id) &&
        (listener.role === 'web' || auth.kind !== 'bearer')
      ) {
        sendForbidden(res)
        return
      }

      if (
        request.id === 'auth.issueWebSessionTicket' &&
        (deps.getWebAccessPolicy().passwordRequired || auth.kind !== 'bearer')
      ) {
        sendForbidden(res)
        return
      }

      const shouldCheckRevision = request.kind === 'command'
      const revisionBefore = shouldCheckRevision
        ? await (await deps.getPersistenceStore()).readAppStateRevision()
        : null
      const result = await deps.controlSurface.invoke(deps.ctx, request)
      if (shouldCheckRevision) {
        try {
          const revisionAfter = await (await deps.getPersistenceStore()).readAppStateRevision()
          if (typeof revisionBefore === 'number' && revisionAfter !== revisionBefore) {
            publishSyncEvent({
              syncClients: deps.syncClients,
              syncEventBuffer: deps.syncEventBuffer,
              maxBufferSize: MAX_SYNC_EVENT_BUFFER,
              desktopSink: deps.desktopSyncEventSink,
              payload: {
                type: 'app_state.updated',
                revision: revisionAfter,
                operationId: request.id,
              },
            })
          }
        } catch {
          // ignore
        }
      }
      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, 400, {
        __opencoveControlEnvelope: true,
        ok: false,
        error: createAppErrorDescriptor('common.invalid_input', {
          debugMessage: error instanceof Error ? error.message : 'Invalid request payload.',
        }),
      })
    }
  }
}
