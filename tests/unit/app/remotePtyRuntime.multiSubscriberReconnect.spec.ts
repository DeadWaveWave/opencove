// @vitest-environment node

import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'

const electronState = vi.hoisted(() => ({
  fromId: vi.fn(() => ({
    isDestroyed: () => false,
    getType: () => 'window',
    once: vi.fn(),
    send: vi.fn(),
  })),
  getAllWebContents: vi.fn(() => []),
}))

vi.mock('electron', () => ({
  webContents: electronState,
}))

import { createRemotePtyRuntime } from '../../../src/app/main/controlSurface/remote/remotePtyRuntime'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('remote PTY multi-subscriber reconnect', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reconnects upstream from the minimum renderer cursor without a fixed delay', async () => {
    const httpServer = createServer((request, response) => {
      request.resume()
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          __opencoveControlEnvelope: true,
          ok: false,
          error: { code: 'session.not_found' },
        }),
      )
    })
    const webSocketServer = new WebSocketServer({ noServer: true })
    const sockets: WebSocket[] = []
    const attachAfterSeq: Array<number | null> = []
    const secondAttach = deferred<number | null>()
    httpServer.on('upgrade', (request, socket, head) => {
      webSocketServer.handleUpgrade(request, socket, head, ws => {
        webSocketServer.emit('connection', ws, request)
      })
    })
    webSocketServer.on('connection', ws => {
      sockets.push(ws)
      ws.on('message', raw => {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>
        if (message.type === 'hello') {
          ws.send(
            JSON.stringify({
              type: 'hello_ack',
              protocolVersion: 1,
              capabilities: { agentReexec: 1, geometryCommitAck: 1 },
            }),
          )
          return
        }
        if (message.type === 'attach') {
          const afterSeq = typeof message.afterSeq === 'number' ? message.afterSeq : null
          attachAfterSeq.push(afterSeq)
          if (attachAfterSeq.length === 2) {
            secondAttach.resolve(afterSeq)
          }
          ws.send(
            JSON.stringify({
              type: 'attached',
              sessionId: message.sessionId,
              role: 'controller',
              authorityEpoch: attachAfterSeq.length,
            }),
          )
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(0, '127.0.0.1', resolve)
    })
    const address = httpServer.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP address')
    }
    const runtime = createRemotePtyRuntime({
      endpointResolver: async () => ({
        hostname: '127.0.0.1',
        port: address.port,
        token: 'test-token',
      }),
    })

    try {
      await runtime.attach(1, 'shared-session', 12)
      await runtime.attach(2, 'shared-session', 4)
      expect(attachAfterSeq).toEqual([12])

      sockets[0]?.terminate()

      await expect(secondAttach.promise).resolves.toBe(4)
      expect(attachAfterSeq).toEqual([12, 4])
    } finally {
      runtime.dispose()
      sockets.forEach(socket => socket.terminate())
      await new Promise<void>(resolve => webSocketServer.close(() => resolve()))
      await new Promise<void>(resolve => httpServer.close(() => resolve()))
    }
  })
})
