import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'
// @vitest-environment node
import { createServer, type ServerResponse } from 'node:http'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { expect, it, vi } from 'vitest'
import { createControlSurfaceHttpRequestHandler } from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import type { ControlSurfaceHttpRequestHandlerDeps } from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'

it('enforces grant scope over HTTP and rejects revoked credentials', async () => {
  const controlSurface = createControlSurface()
  registerSystemHandlers(controlSurface, { appVersion: null })
  const sessionGrants = new SessionGrantRegistry(() => true)
  const { token } = sessionGrants.issue({
    projectId: 'p',
    spaceId: 's',
    nodeId: 'n',
    sessionId: 'session',
  })
  controlSurface.register('session.writeNode', {
    kind: 'command',
    validate: x => x,
    handle: () => ({ accepted: true }),
    defaultErrorCode: 'common.unexpected',
  })
  const getPersistenceStore = vi.fn(async () => ({ readAppStateRevision: async () => 0 }))
  const invoke = vi.spyOn(controlSurface, 'invoke')
  const handler = createControlSurfaceHttpRequestHandler({
    controlSurface,
    token: 'test-token',
    sessionGrants,
    webSessions: new WebSessionManager(),
    ctx: { now: () => new Date(), capabilities: {} },
    isRuntimeClosed: () => false,
    getWebAccessPolicy: () => ({ enabled: false, passwordRequired: false }),
    getPersistenceStore,
  } as unknown as ControlSurfaceHttpRequestHandlerDeps)
  const server = createServer((req, res) => {
    void handler({
      req,
      res,
      listenerSyncClients: new Set(),
      listener: {
        role: 'private',
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        enableWebShell: false,
        webUiPasswordHash: null,
        webUiAuthRevision: 0,
        isWebUiAuthRevisionCurrent: () => true,
      },
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing address')
    }
    const invokeHttp = (id: string, kind: string) =>
      fetch(`http://127.0.0.1:${address.port}/invoke`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, payload: {} }),
      })
    for (const [id, kind, status] of [
      ['system.whoami', 'query', 200],
      ['session.writeNode', 'command', 403],
      ['worker.shutdown', 'command', 403],
      ['unknown', 'query', 403],
      ['auth.issueWebSessionTicket', 'command', 403],
    ] as const) {
      // Requests are sequential to observe authorization and revocation boundaries.
      // eslint-disable-next-line no-await-in-loop
      const response = await invokeHttp(id, kind)
      expect(response.status).toBe(status)
      // Requests are sequential to observe authorization and revocation boundaries.
      // eslint-disable-next-line no-await-in-loop
      const body = await response.json()
      expect(JSON.stringify(body)).not.toContain(token)
      if (status === 403) {
        expect(body.error.code).toBe('common.forbidden')
      } else {
        expect(body.ok).toBe(true)
      }
    }
    expect(invoke).toHaveBeenCalledTimes(1)
    sessionGrants.revokeSession('session')
    const revoked = await invokeHttp('system.whoami', 'query')
    expect(revoked.status).toBe(401)
  } finally {
    server.closeAllConnections()
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      )
    }
  }
})

it('ends an agent runtime event stream when its session grant is revoked', async () => {
  const controlSurface = createControlSurface()
  registerSystemHandlers(controlSurface, { appVersion: null })
  const sessionGrants = new SessionGrantRegistry(() => true)
  const { token } = sessionGrants.issue({
    projectId: 'p',
    spaceId: 's',
    nodeId: 'n',
    sessionId: 'session',
  })
  const agentRuns = new AgentRunStateRegistry({
    epoch: 'worker',
    now: () => Date.now(),
    createTurnId: () => 'turn',
    schedule: () => () => {},
  })
  const agentClients = new Set<ServerResponse>()
  const handler = createControlSurfaceHttpRequestHandler({
    controlSurface,
    token: 'test-token',
    sessionGrants,
    webSessions: new WebSessionManager(),
    ctx: { now: () => new Date(), capabilities: {} },
    isRuntimeClosed: () => false,
    getWebAccessPolicy: () => ({ enabled: false, passwordRequired: false }),
    getPersistenceStore: vi.fn(async () => ({ readAppStateRevision: async () => 0 })),
    agentRuns,
    agentClients,
    syncClients: new Set(),
    syncEventBuffer: [],
  } as unknown as ControlSurfaceHttpRequestHandlerDeps)
  const server = createServer((req, res) => {
    void handler({
      req,
      res,
      listenerSyncClients: new Set(),
      listener: {
        role: 'private',
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        enableWebShell: false,
        webUiPasswordHash: null,
        webUiAuthRevision: 0,
        isWebUiAuthRevisionCurrent: () => true,
      },
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing address')
    }
    const response = await fetch(`http://127.0.0.1:${address.port}/events?stream=agent`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    await reader.read()
    await vi.waitFor(() => expect(agentClients.size).toBe(1))
    sessionGrants.revokeSession('session')
    let done = false
    while (!done) {
      // Drain until the server ends the revoked stream.
      // eslint-disable-next-line no-await-in-loop
      done = (await reader.read()).done
    }
    expect(agentClients.size).toBe(0)
  } finally {
    agentRuns.dispose()
    server.closeAllConnections()
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      )
    }
  }
})
