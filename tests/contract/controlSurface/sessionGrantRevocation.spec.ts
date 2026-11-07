// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WebSocket, WebSocketServer } from 'ws'
import { expect, it, vi } from 'vitest'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import {
  createControlSurfaceHttpRequestHandler,
  type ControlSurfaceHttpRequestHandlerDeps,
} from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import { handlePtyStreamUpgrade } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamService.clientAccess'

function fixture(path = '/invoke') {
  const grants = new SessionGrantRegistry(() => true)
  const { token, grant } = grants.issue({
    projectId: 'p',
    spaceId: 's',
    nodeId: 'n',
    sessionId: 'session',
  })
  const surface = createControlSurface()
  const execute = vi.fn()
  surface.register('session.writeNode', {
    kind: 'command',
    validate: x => x,
    handle: execute,
    defaultErrorCode: 'common.unexpected',
  })
  const req = Object.assign(new EventEmitter(), {
    url: path,
    method: path === '/invoke' ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'sec-websocket-protocol': 'test' },
    socket: {},
  }) as unknown as IncomingMessage
  const res = Object.assign(new EventEmitter(), {
    statusCode: 0,
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }) as unknown as ServerResponse
  const deps = {
    controlSurface: surface,
    token: 'worker',
    sessionGrants: grants,
    webSessions: new WebSessionManager(),
    ctx: { now: () => new Date(), capabilities: {} },
    isRuntimeClosed: () => false,
    getWebAccessPolicy: () => ({ enabled: false, passwordRequired: false }),
    getPersistenceStore: vi.fn(async () => ({ readAppStateRevision: async () => 0 })),
    syncClients: new Set<ServerResponse>(),
    syncEventBuffer: [],
  } as unknown as ControlSurfaceHttpRequestHandlerDeps
  const listenerSyncClients = new Set<ServerResponse>()
  const run = () =>
    createControlSurfaceHttpRequestHandler(deps)({
      req,
      res,
      listenerSyncClients,
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
  const body = () => {
    req.emit('data', JSON.stringify({ kind: 'command', id: 'session.writeNode', payload: {} }))
    req.emit('end')
  }
  return { grants, grant, req, res, deps, execute, run, body, listenerSyncClients }
}

it('revokes authorization while a body is pending', async () => {
  const f = fixture()
  const pending = f.run()
  await vi.waitFor(() => expect(f.req.listenerCount('end')).toBe(1))
  f.grants.revokeSession('session')
  f.body()
  await pending
  expect(f.res.statusCode).toBe(401)
  expect(f.execute).not.toHaveBeenCalled()
})

it('revokes authorization while persistence preparation is pending', async () => {
  const f = fixture()
  let release!: () => void
  const barrier = new Promise<void>(resolve => {
    release = resolve
  })
  const read = vi.fn(async () => {
    await barrier
    return 0
  })
  f.deps.getPersistenceStore = vi.fn(async () => ({
    readAppStateRevision: read,
  })) as typeof f.deps.getPersistenceStore
  const pending = f.run()
  await vi.waitFor(() => expect(f.req.listenerCount('end')).toBe(1))
  f.body()
  await vi.waitFor(() => expect(read).toHaveBeenCalled())
  f.grants.revokeSession('session')
  release()
  await pending
  expect(f.res.statusCode).toBe(401)
  expect(f.execute).not.toHaveBeenCalled()
})

it('removes and ends an established SSE stream synchronously on revoke', async () => {
  const f = fixture('/events')
  await f.run()
  expect(f.deps.syncClients.has(f.res)).toBe(true)
  f.grants.revokeSession('session')
  expect(f.res.end).toHaveBeenCalledOnce()
  expect(f.deps.syncClients.size).toBe(0)
  expect(f.listenerSyncClients.size).toBe(0)
})

it('accepts PTY grant upgrades and terminates established sockets on revoke', () => {
  const f = fixture('/pty')
  const ws = Object.assign(new EventEmitter(), { terminate: vi.fn() }) as unknown as WebSocket
  const wss = Object.assign(new EventEmitter(), {
    handleUpgrade: vi.fn((_req, _socket, _head, done: (socket: WebSocket) => void) => done(ws)),
  }) as unknown as WebSocketServer
  const connected = vi.fn()
  wss.on('connection', connected)
  const socket = { destroy: vi.fn(), write: vi.fn() } as unknown as Duplex
  handlePtyStreamUpgrade({
    req: f.req,
    socket,
    head: Buffer.alloc(0),
    context: { listenerRole: 'private' },
    ingressFrozen: false,
    token: 'worker',
    sessionGrants: f.grants,
    webSessions: f.deps.webSessions,
    allowQueryToken: false,
    now: () => new Date(),
    path: '/pty',
    subprotocol: 'test',
    wss,
    stateBySocket: new WeakMap(),
  })
  expect(connected).toHaveBeenCalledOnce()
  f.grants.revokeSession('session')
  expect(ws.terminate).toHaveBeenCalledOnce()
  f.grants.clear()
  expect(ws.terminate).toHaveBeenCalledOnce()
})

it('closes late subscribers and fans out even if another transport throws', () => {
  const f = fixture()
  f.grants.onRevoke(f.grant.grantId, () => {
    throw new Error('broken transport')
  })
  const close = vi.fn()
  f.grants.onRevoke(f.grant.grantId, close)
  f.grants.clear()
  expect(close).toHaveBeenCalledOnce()
  const late = vi.fn()
  f.grants.onRevoke(f.grant.grantId, late)
  expect(late).toHaveBeenCalledOnce()
})

it('does not publish a resync or resurrect SSE after revocation during revision lookup', async () => {
  const f = fixture('/events?afterRevision=0')
  f.deps.syncEventBuffer.push({ type: 'app_state.updated', revision: 5, operationId: 'test' })
  let release!: () => void
  const barrier = new Promise<void>(resolve => {
    release = resolve
  })
  const read = vi.fn(async () => {
    await barrier
    return 6
  })
  f.deps.getPersistenceStore = vi.fn(async () => ({
    readAppStateRevision: read,
  })) as typeof f.deps.getPersistenceStore
  const pending = f.run()
  await vi.waitFor(() => expect(read).toHaveBeenCalled())
  const writes = vi.mocked(f.res.write).mock.calls.length
  f.grants.revokeSession('session')
  release()
  await pending
  expect(f.res.write).toHaveBeenCalledTimes(writes)
  expect(f.deps.syncClients.size).toBe(0)
  expect(f.res.end).toHaveBeenCalledOnce()
})
