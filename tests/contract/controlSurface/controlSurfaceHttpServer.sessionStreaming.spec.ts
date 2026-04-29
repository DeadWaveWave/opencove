// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  disposeAndCleanup,
  sendJson,
  toWsUrl,
  waitForMessage,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

describe('Control Surface HTTP server (session streaming)', () => {
  it('rejects websocket connections without the subprotocol', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const connectionFileName = 'control-surface.pty.subprotocol.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )

    const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
    const exitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'test-token',
      connectionFileName,
      approvedWorkspaces,
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'test-session' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: listener => {
          dataListeners.add(listener)
          return () => {
            dataListeners.delete(listener)
          }
        },
        onExit: listener => {
          exitListeners.add(listener)
          return () => {
            exitListeners.delete(listener)
          }
        },
      },
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const wsUrl = toWsUrl(baseUrl, '/pty', { token: 'test-token' })

      await new Promise<void>((resolvePromise, rejectPromise) => {
        const ws = new WebSocket(wsUrl)
        const timer = setTimeout(() => {
          ws.terminate()
          rejectPromise(new Error('Timed out waiting for connection rejection'))
        }, 2_000)

        ws.once('open', () => {
          clearTimeout(timer)
          ws.close()
          rejectPromise(new Error('Expected connection to be rejected'))
        })

        ws.once('error', () => {
          clearTimeout(timer)
          resolvePromise()
        })
      })
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })

  it('requires hello handshake and validates protocol version', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const connectionFileName = 'control-surface.pty.handshake.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )

    const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
    const exitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'test-token',
      connectionFileName,
      approvedWorkspaces,
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'test-session' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: listener => {
          dataListeners.add(listener)
          return () => {
            dataListeners.delete(listener)
          }
        },
        onExit: listener => {
          exitListeners.add(listener)
          return () => {
            exitListeners.delete(listener)
          }
        },
      },
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const wsUrl = toWsUrl(baseUrl, '/pty', { token: 'test-token' })

      const ws = new WebSocket(wsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        ws.once('open', resolvePromise)
        ws.once('error', rejectPromise)
      })

      sendJson(ws, { type: 'attach', sessionId: 'whatever' })
      const expectedHello = await waitForMessage<{ type: string; code: string }>(
        ws,
        message =>
          message && message.type === 'error' && message.code === 'protocol.expected_hello',
      )
      expect(expectedHello.code).toBe('protocol.expected_hello')

      ws.close()

      const wsVersion = new WebSocket(wsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        wsVersion.once('open', resolvePromise)
        wsVersion.once('error', rejectPromise)
      })

      sendJson(wsVersion, { type: 'hello', protocolVersion: 999, client: { kind: 'cli' } })
      const mismatch = await waitForMessage<{ type: string; code: string }>(
        wsVersion,
        message =>
          message && message.type === 'error' && message.code === 'protocol.version_mismatch',
      )
      expect(mismatch.code).toBe('protocol.version_mismatch')
      wsVersion.close()
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })
})
