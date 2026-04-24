// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
  disposeAndCleanup,
  invoke,
  safeRemoveDirectory,
  sendJson,
  toWsUrl,
  waitForCondition,
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

  it('supports presentation snapshots, attach catch-up, controller enforcement, and overflow recovery', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-workspace-'))
    const connectionFileName = 'control-surface.pty.streaming.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
    const exitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()

    const writes: Array<{ sessionId: string; data: string }> = []
    const resizes: Array<{ sessionId: string; cols: number; rows: number }> = []

    let sessionCounter = 0
    const spawnSessionId = (): string => `test-session-${sessionCounter++}`

    type TestPtyRuntime = ControlSurfacePtyRuntime & {
      emitData: (sessionId: string, data: string) => void
    }

    const ptyRuntime: TestPtyRuntime = {
      spawnSession: async () => ({ sessionId: spawnSessionId() }),
      write: (sessionId: string, data: string) => {
        writes.push({ sessionId, data })
      },
      resize: (sessionId: string, cols: number, rows: number) => {
        resizes.push({ sessionId, cols, rows })
      },
      kill: () => undefined,
      onData: (listener: (event: { sessionId: string; data: string }) => void) => {
        dataListeners.add(listener)
        return () => {
          dataListeners.delete(listener)
        }
      },
      onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => {
        exitListeners.add(listener)
        return () => {
          exitListeners.delete(listener)
        }
      },
      emitData: (sessionId: string, data: string) => {
        dataListeners.forEach(listener => listener({ sessionId, data }))
      },
    }

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'test-token',
      connectionFileName,
      approvedWorkspaces,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime,
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const wsUrl = toWsUrl(baseUrl, '/pty', { token: 'test-token' })

      const workspaceId = randomUUID()
      const spaceId = randomUUID()
      const initialState = createMinimalState(workspacePath, workspaceId, spaceId)

      const writeStateRes = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: initialState },
      })
      expect(writeStateRes.status, JSON.stringify(writeStateRes.data)).toBe(200)

      const spawnRes = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'session.spawnTerminal',
        payload: { spaceId, cols: 80, rows: 24 },
      })
      expect(spawnRes.status).toBe(200)
      expect(spawnRes.data.ok).toBe(true)
      const sessionId = spawnRes.data.value?.sessionId as string
      expect(sessionId).toContain('test-session-')

      const controller = new WebSocket(wsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        controller.once('open', resolvePromise)
        controller.once('error', rejectPromise)
      })
      const controllerMessages: Array<Record<string, unknown>> = []
      controller.on('message', raw => {
        try {
          const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            controllerMessages.push(parsed as Record<string, unknown>)
          }
        } catch {
          // ignore
        }
      })

      sendJson(controller, { type: 'hello', protocolVersion: 1, client: { kind: 'cli' } })
      await waitForMessage(controller, message => message && message.type === 'hello_ack')
      sendJson(controller, { type: 'attach', sessionId, role: 'controller' })
      const controllerAttached = await waitForMessage<{ type: string; role: string }>(
        controller,
        message => message && message.type === 'attached' && message.sessionId === sessionId,
      )
      expect(controllerAttached.role).toBe('controller')

      const viewer = new WebSocket(wsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        viewer.once('open', resolvePromise)
        viewer.once('error', rejectPromise)
      })
      const viewerMessages: Array<Record<string, unknown>> = []
      viewer.on('message', raw => {
        try {
          const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            viewerMessages.push(parsed as Record<string, unknown>)
          }
        } catch {
          // ignore
        }
      })

      sendJson(viewer, { type: 'hello', protocolVersion: 1, client: { kind: 'cli' } })
      await waitForMessage(viewer, message => message && message.type === 'hello_ack')
      sendJson(viewer, { type: 'attach', sessionId, role: 'controller' })
      const viewerAttached = await waitForMessage<{ type: string; role: string }>(
        viewer,
        message => message && message.type === 'attached' && message.sessionId === sessionId,
      )
      expect(viewerAttached.role).toBe('viewer')

      const viewerControlChangedPromise = waitForMessage<{ type: string; role: string }>(
        viewer,
        message =>
          message &&
          message.type === 'control_changed' &&
          message.sessionId === sessionId &&
          message.role === 'controller',
      )

      const controllerControlReleasedPromise = waitForMessage<{ type: string; role: string }>(
        controller,
        message =>
          message &&
          message.type === 'control_changed' &&
          message.sessionId === sessionId &&
          message.role === 'viewer',
      )

      sendJson(viewer, { type: 'request_control', sessionId })
      const [viewerControlChanged, controllerControlReleased] = await Promise.all([
        viewerControlChangedPromise,
        controllerControlReleasedPromise,
      ])
      expect(viewerControlChanged.role).toBe('controller')
      expect(controllerControlReleased.role).toBe('viewer')

      const writePayload = 'echo ok\r'
      sendJson(viewer, { type: 'write', sessionId, data: writePayload })
      await waitForCondition(async () => {
        return writes.some(write => write.sessionId === sessionId && write.data === writePayload)
      })
      expect(
        writes.some(write => write.sessionId === sessionId && write.data === writePayload),
      ).toBe(true)

      sendJson(controller, {
        type: 'resize',
        sessionId,
        cols: 100,
        rows: 32,
        reason: 'frame_commit',
      })
      await waitForCondition(async () =>
        controllerMessages.some(
          message =>
            message.type === 'error' &&
            message.sessionId === sessionId &&
            message.code === 'session.not_controller',
        ),
      )

      sendJson(viewer, {
        type: 'resize',
        sessionId,
        cols: 100,
        rows: 32,
        reason: 'frame_commit',
      })
      await waitForCondition(async () => {
        const controllerGeometryReceived = controllerMessages.some(
          message =>
            message.type === 'geometry' &&
            message.sessionId === sessionId &&
            message.cols === 100 &&
            message.rows === 32 &&
            message.reason === 'frame_commit',
        )
        const viewerGeometryReceived = viewerMessages.some(
          message =>
            message.type === 'geometry' &&
            message.sessionId === sessionId &&
            message.cols === 100 &&
            message.rows === 32 &&
            message.reason === 'frame_commit',
        )
        return controllerGeometryReceived && viewerGeometryReceived
      })
      expect(resizes).toContainEqual({ sessionId, cols: 100, rows: 32 })

      ptyRuntime.emitData(sessionId, 'presentation-ready\r\n')
      const presentationSnapshot = await invoke(baseUrl, 'test-token', {
        kind: 'query',
        id: 'session.presentationSnapshot',
        payload: { sessionId },
      })
      expect(presentationSnapshot.status).toBe(200)
      expect(presentationSnapshot.data.ok).toBe(true)
      expect(presentationSnapshot.data.value?.sessionId).toBe(sessionId)
      expect(presentationSnapshot.data.value?.cols).toBe(100)
      expect(presentationSnapshot.data.value?.rows).toBe(32)
      expect(presentationSnapshot.data.value?.serializedScreen).toContain('presentation-ready')

      ptyRuntime.emitData(sessionId, 'attach-delta\r\n')
      const catchupViewer = new WebSocket(wsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        catchupViewer.once('open', resolvePromise)
        catchupViewer.once('error', rejectPromise)
      })

      sendJson(catchupViewer, { type: 'hello', protocolVersion: 1, client: { kind: 'cli' } })
      await waitForMessage(catchupViewer, message => message && message.type === 'hello_ack')
      const catchupChunkPromise = waitForMessage<{ type: string; data: string }>(
        catchupViewer,
        message =>
          message &&
          message.type === 'data' &&
          message.sessionId === sessionId &&
          typeof message.data === 'string' &&
          message.data.includes('attach-delta'),
      )
      sendJson(catchupViewer, {
        type: 'attach',
        sessionId,
        role: 'viewer',
        afterSeq: presentationSnapshot.data.value?.appliedSeq,
      })

      await waitForMessage(
        catchupViewer,
        message => message && message.type === 'attached' && message.sessionId === sessionId,
      )
      const catchupChunk = await catchupChunkPromise
      expect(catchupChunk.data).toContain('attach-delta')
      catchupViewer.close()

      controller.close()
      viewer.close()

      const bigChunk = 'x'.repeat(410_000)
      ptyRuntime.emitData(sessionId, bigChunk)
      ptyRuntime.emitData(sessionId, 'y'.repeat(410_000))

      const reconnect = new WebSocket(wsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        reconnect.once('open', resolvePromise)
        reconnect.once('error', rejectPromise)
      })

      sendJson(reconnect, { type: 'hello', protocolVersion: 1, client: { kind: 'cli' } })
      await waitForMessage(reconnect, message => message && message.type === 'hello_ack')
      sendJson(reconnect, { type: 'attach', sessionId, afterSeq: 0, role: 'viewer' })
      const overflow = await waitForMessage<{ type: string; reason: string; recovery: string }>(
        reconnect,
        message =>
          message &&
          message.type === 'overflow' &&
          message.sessionId === sessionId &&
          message.reason === 'replay_window_exceeded',
        { timeoutMs: 4_000 },
      )
      expect(overflow.recovery).toBe('snapshot')

      const snapshot = await invoke(baseUrl, 'test-token', {
        kind: 'query',
        id: 'session.snapshot',
        payload: { sessionId },
      })
      expect(snapshot.status).toBe(200)
      expect(snapshot.data.ok).toBe(true)
      expect(snapshot.data.value?.sessionId).toBe(sessionId)
      expect(snapshot.data.value?.truncated).toBe(true)
      expect(snapshot.data.value?.fromSeq).toBeGreaterThan(0)
      expect(snapshot.data.value?.toSeq).toBeGreaterThan(0)

      reconnect.close()
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })

      await safeRemoveDirectory(workspacePath)
    }
  })
})
