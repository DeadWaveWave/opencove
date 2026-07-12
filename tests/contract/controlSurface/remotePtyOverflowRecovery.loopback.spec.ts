// @vitest-environment node

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { createMultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import { createPtyStreamService } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamService'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'
import { waitForCondition } from './controlSurfaceHttpServer.sessionStreaming.testUtils'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createClientSocketHarness() {
  const messages: Array<Record<string, unknown>> = []
  return {
    messages,
    ws: {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: 0,
      send: (raw: string) => messages.push(JSON.parse(raw) as Record<string, unknown>),
      close: vi.fn(),
    } as never,
  }
}

describe('Remote PTY overflow loopback recovery', () => {
  it('resets from HTTP snapshot, drains live WS data once, and fences stale Home clients', async () => {
    const snapshotGate = deferred()
    const snapshotRequested = deferred()
    let connectionCount = 0
    let activeSocket: WebSocket | null = null
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/invoke') {
        response.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: string }
      if (body.id === 'session.presentationSnapshot') {
        snapshotRequested.resolve()
        await snapshotGate.promise
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: {
              sessionId: 'remote-session',
              epoch: 1,
              appliedSeq: 10,
              presentationRevision: 10,
              cols: 80,
              rows: 24,
              geometryRevision: 1,
              bufferKind: 'normal',
              cursor: { x: 0, y: 2 },
              title: null,
              serializedScreen: 'REMOTE_SNAPSHOT_BASE\r\nREMOTE_DOWNTIME_SNAPSHOT\r\n',
            },
          }),
        )
        return
      }
      response.writeHead(404).end()
    })
    const wss = new WebSocketServer({
      noServer: true,
      handleProtocols: () => 'opencove-pty.v1',
    })
    server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request))
    })
    wss.on('connection', ws => {
      connectionCount += 1
      activeSocket = ws
      let attached = false
      ws.on('message', raw => {
        const message = JSON.parse(raw.toString()) as { type?: string; sessionId?: string }
        if (message.type === 'hello') {
          ws.send(
            JSON.stringify({
              type: 'hello_ack',
              protocolVersion: 1,
              server: { instanceId: 'remote-worker-instance' },
              capabilities: { geometryCommitAck: 1 },
            }),
          )
          return
        }
        if (message.type !== 'attach' || attached) {
          return
        }
        attached = true
        if (connectionCount === 1) {
          ws.send(
            JSON.stringify({
              type: 'attached',
              sessionId: 'remote-session',
              seq: 5,
              earliestSeq: 1,
              role: 'controller',
              authorityEpoch: 1,
            }),
          )
          ws.send(
            JSON.stringify({
              type: 'data',
              sessionId: 'remote-session',
              seq: 5,
              data: 'REMOTE_SNAPSHOT_BASE\r\n',
            }),
          )
          return
        }
        ws.send(
          JSON.stringify({
            type: 'attached',
            sessionId: 'remote-session',
            seq: 10,
            earliestSeq: 8,
            role: 'controller',
            authorityEpoch: 2,
          }),
        )
        ws.send(
          JSON.stringify({
            type: 'overflow',
            sessionId: 'remote-session',
            seq: 10,
            earliestSeq: 8,
          }),
        )
        ws.send(
          JSON.stringify({
            type: 'data',
            sessionId: 'remote-session',
            seq: 11,
            data: 'REMOTE_LIVE_DURING_SNAPSHOT\r\n',
          }),
        )
      })
    })

    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    const port = (server.address() as AddressInfo).port
    const localRuntime: ControlSurfacePtyRuntime = {
      spawnSession: vi.fn(async () => ({ sessionId: 'local-session' })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
    }
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime,
      topology: {
        resolveRemoteEndpointConnection: vi.fn(async () => ({
          hostname: '127.0.0.1',
          port,
          token: 'loopback-token',
        })),
      } as unknown as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })
    const service = createPtyStreamService({
      token: 'home-token',
      webSessions: new WebSessionManager(),
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      ptyRuntime: runtime,
      replayWindowMaxBytes: 64_000,
    })

    try {
      const homeSessionId = runtime.registerRemoteSession({
        endpointId: 'endpoint-1',
        remoteSessionId: 'remote-session',
      })
      service.hub.registerSessionMetadata({
        sessionId: homeSessionId,
        kind: 'terminal',
        startedAt: '2026-07-10T00:00:00.000Z',
        cwd: '/remote',
        command: 'shell',
        args: [],
        cols: 80,
        rows: 24,
      })
      await waitForCondition(async () => {
        const value = await service.hub.presentationSnapshotSession(homeSessionId)
        return value.serializedScreen.includes('REMOTE_SNAPSHOT_BASE')
      })
      const beforeReset = await service.hub.presentationSnapshotSession(homeSessionId)
      activeSocket?.close()

      await snapshotRequested.promise
      let cutoffResolved = false
      const cutoff = service.quiesce().then(() => {
        cutoffResolved = true
      })
      await Promise.resolve()
      expect(cutoffResolved).toBe(false)
      snapshotGate.resolve()
      await cutoff
      await waitForCondition(
        async () => {
          const value = await service.hub.presentationSnapshotSession(homeSessionId)
          return value.serializedScreen.includes('REMOTE_LIVE_DURING_SNAPSHOT')
        },
        { timeoutMs: 4_000, intervalMs: 20 },
      )

      const afterReset = await service.hub.presentationSnapshotSession(homeSessionId)
      const screen = afterReset.serializedScreen
      expect(screen.indexOf('REMOTE_SNAPSHOT_BASE')).toBeLessThan(
        screen.indexOf('REMOTE_DOWNTIME_SNAPSHOT'),
      )
      expect(screen.indexOf('REMOTE_DOWNTIME_SNAPSHOT')).toBeLessThan(
        screen.indexOf('REMOTE_LIVE_DURING_SNAPSHOT'),
      )
      for (const token of [
        'REMOTE_SNAPSHOT_BASE',
        'REMOTE_DOWNTIME_SNAPSHOT',
        'REMOTE_LIVE_DURING_SNAPSHOT',
      ]) {
        expect(screen.split(token)).toHaveLength(2)
      }

      const stale = createClientSocketHarness()
      service.hub.registerClient({ clientId: 'stale', kind: 'web', ws: stale.ws })
      service.hub.attach({
        clientId: 'stale',
        sessionId: homeSessionId,
        afterSeq: beforeReset.appliedSeq,
      })
      expect(stale.messages.map(message => message.type)).toContain('overflow')

      const fresh = createClientSocketHarness()
      service.hub.registerClient({ clientId: 'fresh', kind: 'web', ws: fresh.ws })
      service.hub.attach({
        clientId: 'fresh',
        sessionId: homeSessionId,
        afterSeq: afterReset.appliedSeq,
      })
      expect(fresh.messages.map(message => message.type)).not.toContain('overflow')
    } finally {
      service.dispose()
      runtime.dispose()
      wss.close()
      await new Promise<void>(resolvePromise => server.close(() => resolvePromise()))
    }
  })
})
