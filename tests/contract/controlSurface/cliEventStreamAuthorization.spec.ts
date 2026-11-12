// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'
import {
  createControlSurfaceHttpRequestHandler,
  type ControlSurfaceHttpRequestHandlerDeps,
} from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { canonicalSelection } from '../../../src/shared/contracts/dto/eventStream'
function fixture(tier: 'read' | 'interact' | 'bearer' = 'interact') {
  const grants = new SessionGrantRegistry(() => true)
  const issued = grants.issue({
    projectId: 'caller-project',
    spaceId: 's',
    nodeId: 'caller',
    sessionId: 'session',
  })
  // Production issue/reserve only issue interact. Override verified authority in this read fixture.
  if (tier === 'read') {
    const verify = grants.verify.bind(grants)
    vi.spyOn(grants, 'verify').mockImplementation(token => {
      const grant = verify(token)
      return grant ? { ...grant, tier: 'read' } : null
    })
  }
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  const url = new URL('http://fake/events?stream=agent&format=cli-v1')
  url.searchParams.set('selection', JSON.stringify(canonicalSelection({})))
  const req = Object.assign(new EventEmitter(), {
    url: url.pathname + url.search,
    method: 'GET',
    headers: { authorization: `Bearer ${tier === 'bearer' ? 'worker' : issued.token}` },
    socket: {},
  }) as unknown as IncomingMessage
  const res = Object.assign(new EventEmitter(), {
    statusCode: 0,
    destroyed: false,
    writableEnded: false,
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(() => {
      res.writableEnded = true
    }),
  })
  const readMany = vi.fn(async () => new Map())
  const deps = {
    token: 'worker',
    sessionGrants: grants,
    webSessions: new WebSessionManager(),
    controlSurface: createControlSurface(),
    ctx: { now: () => new Date(), capabilities: {} },
    agentRuns: registry,
    agentClients: new Set(),
    syncClients: new Set(),
    syncEventBuffer: [],
    isRuntimeClosed: () => false,
    getWebAccessPolicy: () => ({ enabled: false, passwordRequired: false }),
    getPersistenceStore: async () => ({ nodeLineage: { readMany } }),
  } as unknown as ControlSurfaceHttpRequestHandlerDeps
  const run = () =>
    createControlSurfaceHttpRequestHandler(deps)({
      req,
      res: res as unknown as ServerResponse,
      listenerSyncClients: new Set(),
      listener: {
        role: 'private',
        hostname: 'localhost',
        bindHostname: 'localhost',
        port: 0,
        enableWebShell: false,
        webUiPasswordHash: null,
        webUiAuthRevision: 0,
        isWebUiAuthRevisionCurrent: () => true,
      },
    })
  const publish = (id: string) =>
    registry.register({
      sessionId: id,
      nodeId: id,
      provider: 'codex',
      incarnation: id,
      projectId: 'other-project',
    })
  return { grants, registry, req, res, readMany, run, publish, deps }
}
it.each(['read', 'interact', 'bearer'] as const)(
  'accepts %s read authority without inventing project isolation',
  async tier => {
    const f = fixture(tier)
    await f.run()
    f.publish('child')
    await vi.waitFor(() => expect(f.res.write).toHaveBeenCalledTimes(2))
    expect(f.res.write.mock.calls[1][0]).toContain('other-project')
    f.req.emit('close')
  },
)
it('rechecks actual grant liveness after a blocked lookup and synchronously removes subscriptions', async () => {
  const f = fixture()
  await f.run()
  f.publish('first')
  await vi.waitFor(() => expect(f.res.write).toHaveBeenCalledTimes(2))
  let release!: () => void
  f.readMany.mockImplementationOnce(async () => {
    await new Promise<void>(r => {
      release = r
    })
    return new Map()
  })
  f.publish('second')
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const writes = f.res.write.mock.calls.length
  f.grants.revokeSession('session')
  expect(f.deps.agentClients!.size).toBe(0)
  release()
  f.publish('third')
  await new Promise(r => setTimeout(r, 0))
  expect(f.res.write).toHaveBeenCalledTimes(writes)
})
it('rejects invalidated credentials before subscribing', async () => {
  const f = fixture()
  f.grants.clear()
  await f.run()
  expect(f.res.statusCode).toBe(401)
  expect(f.res.write).not.toHaveBeenCalled()
})
it('rejects malformed selections before any ready record', async () => {
  const f = fixture()
  f.req.url = '/events?stream=agent&format=cli-v1&selection=broken'
  await f.run()
  expect(f.res.statusCode).toBe(400)
  expect(f.res.write).not.toHaveBeenCalled()
})
it('applies operation-read policy before subscribing, even for a valid grant', async () => {
  const authorization =
    await import('../../../src/app/main/controlSurface/http/sessionGrantAuthorization')
  const spy = vi.spyOn(authorization, 'sessionGrantAllowsOperation').mockReturnValue(false)
  try {
    const f = fixture()
    await f.run()
    expect(f.res.statusCode).toBe(403)
    expect(f.res.write).not.toHaveBeenCalled()
    expect(f.deps.agentClients!.size).toBe(0)
  } finally {
    spy.mockRestore()
  }
})
