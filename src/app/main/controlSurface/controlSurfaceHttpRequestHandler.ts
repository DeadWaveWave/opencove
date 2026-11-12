import { serveCliEventStream } from './http/cliEventStream'
import { tryManagedClaudeTestHook } from './http/managedClaudeTestHook'
import { invokeCallerLifetime } from './http/invokeCallerLifetime'
import type { AgentRunStateRegistry } from '../../../contexts/agent/application/AgentRunStateRegistry'
import { isAgentRuntimeStream, serveAgentRuntimeEvents } from './http/agentRuntimeSse'
import type { SessionGrantRegistry } from './http/sessionGrantRegistry'
import {
  sessionGrantAllowsOperation,
  sessionGrantDeniedError,
} from './http/sessionGrantAuthorization'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../shared/contracts/controlSurface'
import type { PluginInstallationManager } from '../../../contexts/plugins/application/PluginInstallationManager'
import { tryHandlePluginAssetRoute } from './pluginAssetRoutes'
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
import { type SyncEventPayload } from './http/syncSse'
import { tryHandleWebAuthRoutes } from './http/webAuthRoutes'
import { gateWebUiEntrypoint } from './http/webUiEntryGate'
import { serveSyncEvents } from './http/serveSyncEvents'
import { shouldAllowDevWebUiOrigin } from './http/devWebUiOrigin'
import { buildUnauthorizedResult } from './http/unauthorizedResult'
import type {
  ControlSurfaceHttpListenerOptions,
  ControlSurfaceHttpListenerRequestContext,
  ControlSurfaceWebAccessPolicy,
} from './controlSurfaceHttpRuntime.contract'

export interface ControlSurfaceHttpRequestHandlerDeps {
  plugins: PluginInstallationManager
  ctx: ControlSurfaceContext
  token: string
  sessionGrants?: SessionGrantRegistry
  webSessions: WebSessionManager
  controlSurface: ControlSurface
  getPersistenceStore: () => Promise<PersistenceStore>
  agentRuns?: AgentRunStateRegistry
  agentClients?: Set<ServerResponse>
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
    return auth.kind === 'bearer' || auth.kind === 'query_token' || auth.kind === 'session-grant'
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
  listener: ControlSurfaceHttpListenerRequestContext
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
    if (await tryHandlePluginAssetRoute({ req, res, url, plugins: deps.plugins })) {
      return
    }

    if (
      servesWeb &&
      (await tryHandleWebAuthRoutes({
        req,
        res,
        url,
        now: deps.ctx.now,
        webSessions: deps.webSessions,
        webUiPasswordHash: listener.webUiPasswordHash,
        isWebUiAuthRevisionCurrent: listener.isWebUiAuthRevisionCurrent,
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
          sessionGrants: deps.sessionGrants,
          webSessions: deps.webSessions,
          allowQueryToken: true,
          now: deps.ctx.now(),
        })
        if (!auth || !listenerAllowsAuth(listener.role, auth)) {
          sendJson(res, 401, buildUnauthorizedResult())
          return
        }

        let disposeStream: (() => void) | undefined
        let streamRevoked = false
        const unsubscribeGrant =
          auth.kind === 'session-grant'
            ? deps.sessionGrants?.onRevoke(auth.grant.grantId, () => {
                streamRevoked = true
                disposeStream?.()
                deps.syncClients.delete(res)
                deps.agentClients?.delete(res)
                listenerSyncClients.delete(res)
                res.end()
              })
            : undefined
        res.once('close', () => unsubscribeGrant?.())
        if (streamRevoked) {
          return
        }

        // A revoked session grant ends the agent runtime stream too (subscription above).
        if (isAgentRuntimeStream(url)) {
          if (!deps.agentRuns || !deps.agentClients) {
            res.statusCode = 503
            res.end()
            return
          }
          if (url.searchParams.get('format') === 'cli-v1') {
            if (auth.kind === 'query_token') {
              sendForbidden(res)
              return
            }
            if (
              auth.kind === 'session-grant' &&
              !['agent.list', 'agent.get', 'node.get'].every(id =>
                sessionGrantAllowsOperation(id, auth.grant.tier),
              )
            ) {
              sendForbidden(res)
              return
            }
            disposeStream = serveCliEventStream({
              req,
              res,
              url,
              registry: deps.agentRuns,
              clients: deps.agentClients,
              listenerClients: listenerSyncClients,
              isActive: () =>
                !streamRevoked &&
                !deps.isRuntimeClosed() &&
                (auth.kind !== 'session-grant' ||
                  Boolean(deps.sessionGrants?.isActive(auth.grant.grantId))),
              readLineage: async () => (await deps.getPersistenceStore()).nodeLineage,
            })
            if (streamRevoked) {
              disposeStream()
            }
            return
          }
          serveAgentRuntimeEvents({
            req,
            res,
            url,
            registry: deps.agentRuns,
            clients: deps.agentClients,
            listenerClients: listenerSyncClients,
          })
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

        await serveSyncEvents({
          req,
          res,
          clients: deps.syncClients,
          listenerClients: listenerSyncClients,
          buffer: deps.syncEventBuffer,
          afterRevision,
          isRevoked: () => streamRevoked || deps.isRuntimeClosed(),
          readSnapshot: async () => {
            const store = await deps.getPersistenceStore()
            if (!store.readAppStateSnapshot) {
              throw new Error('Canonical snapshot unavailable')
            }
            return store.readAppStateSnapshot()
          },
        })
        return
      }
    }

    if (req.method !== 'POST' || !['/invoke', '/_test/managed-claude-rebind'].includes(req.url)) {
      res.statusCode = 404
      res.end()
      return
    }

    const auth = resolveRequestAuth({
      req,
      url,
      token: deps.token,
      sessionGrants: deps.sessionGrants,
      webSessions: deps.webSessions,
      allowQueryToken: false,
      now: deps.ctx.now(),
    })
    if (!auth || !listenerAllowsAuth(listener.role, auth)) {
      sendJson(res, 401, buildUnauthorizedResult())
      return
    }

    if (
      await tryManagedClaudeTestHook({
        req,
        res,
        privateBearer: listener.role !== 'web' && auth.kind === 'bearer',
        getStore: deps.getPersistenceStore,
      })
    ) {
      return
    }
    if (req.url !== '/invoke') {
      res.statusCode = 404
      res.end()
      return
    }

    const clientProtocol = req.headers['x-opencove-protocol']
    if (
      clientProtocol !== undefined &&
      clientProtocol !== String(CONTROL_SURFACE_PROTOCOL_VERSION)
    ) {
      sendJson(res, 200, {
        __opencoveControlEnvelope: true,
        ok: false,
        error: createAppErrorDescriptor('common.protocol_incompatible', {
          params: {
            client: Array.isArray(clientProtocol) ? clientProtocol.join(', ') : clientProtocol,
            server: CONTROL_SURFACE_PROTOCOL_VERSION,
          },
        }),
      })
      return
    }

    try {
      const request = normalizeInvokeRequest(await readJsonBody(req))
      if (auth.kind === 'session-grant' && !deps.sessionGrants?.isActive(auth.grant.grantId)) {
        sendJson(res, 401, buildUnauthorizedResult())
        return
      }
      if (
        auth.kind === 'session-grant' &&
        !sessionGrantAllowsOperation(request.id, auth.grant.tier)
      ) {
        sendJson(res, 403, {
          __opencoveControlEnvelope: true,
          ok: false,
          error: sessionGrantDeniedError(request.id, auth.grant.tier),
        })
        return
      }
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

      if (auth.kind === 'session-grant' && !deps.sessionGrants?.isActive(auth.grant.grantId)) {
        sendJson(res, 401, buildUnauthorizedResult())
        return
      }
      const caller = invokeCallerLifetime(deps.ctx, res, auth, deps.sessionGrants, deps.webSessions)
      let result
      try {
        result = await deps.controlSurface.invoke(
          {
            ...deps.ctx,
            requestAuth: auth,
            signal: caller.signal,
            assertActive: caller.assertActive,
          },
          request,
        )
      } finally {
        caller.dispose()
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
