// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type {
  TerminalForegroundEvent,
  TerminalSessionMetadataEvent,
} from '../../../src/shared/contracts/dto'
import {
  createInMemoryPersistenceStore,
  disposeAndCleanup,
  invoke,
  safeRemoveDirectory,
  sendJson,
  toWsUrl,
  waitForMessage,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

describe('Control Surface terminal Agent re-exec stream operation', () => {
  it('keeps command construction Worker-owned and enforces the controller lease', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-agent-reexec-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-agent-reexec-workspace-'))
    const connectionFileName = 'control-surface.agent-reexec.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    const foregroundListeners = new Set<(event: TerminalForegroundEvent) => void>()
    const metadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
    const writes: string[] = []
    const runtime = {
      spawnSession: vi.fn(async () => ({ sessionId: 'session-1' })),
      write: (_sessionId: string, data: string) => {
        writes.push(data)
        if (data === '\u0003') {
          const event: TerminalForegroundEvent = {
            sessionId: 'session-1',
            observedAtMs: Date.now() + 1,
            source: 'process_scan',
            exitCode: null,
            availability: 'available',
            agent: null,
            shellOnly: true,
          }
          foregroundListeners.forEach(listener => listener(event))
        }
      },
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
      onForeground: (listener: (event: TerminalForegroundEvent) => void) => {
        foregroundListeners.add(listener)
        return () => foregroundListeners.delete(listener)
      },
      onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => {
        metadataListeners.add(listener)
        return () => metadataListeners.delete(listener)
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
      ptyRuntime: runtime,
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const spawned = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'pty.spawn',
        payload: { cwd: workspacePath, cols: 80, rows: 24 },
      })
      expect(spawned.data.ok).toBe(true)
      metadataListeners.forEach(listener =>
        listener({ sessionId: 'session-1', resumeSessionId: null, agentProvider: 'pi' }),
      )

      const wsUrl = toWsUrl(baseUrl, '/pty', { token: 'test-token' })
      const controller = new WebSocket(wsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        controller.once('open', resolvePromise)
        controller.once('error', rejectPromise)
      })
      sendJson(controller, { type: 'hello', protocolVersion: 1, client: { kind: 'web' } })
      const hello = await waitForMessage<Record<string, unknown>>(
        controller,
        message => message?.type === 'hello_ack',
      )
      expect((hello.capabilities as { agentReexec?: unknown }).agentReexec).toBe(1)
      sendJson(controller, { type: 'attach', sessionId: 'session-1', role: 'controller' })
      const attached = await waitForMessage<{ authorityEpoch: number }>(
        controller,
        message => message?.type === 'attached' && message.sessionId === 'session-1',
      )

      sendJson(controller, {
        type: 'agent_reexec',
        sessionId: 'session-1',
        operationId: 'operation-1',
        provider: 'pi',
        resumeSessionId: null,
        expectedActivity: null,
        authorityEpoch: attached.authorityEpoch,
      })
      const accepted = await waitForMessage<{ status: string }>(
        controller,
        message => message?.type === 'agent_reexec_result',
      )
      expect(accepted.status).toBe('reexecuted')
      expect(writes).toEqual(['\u0003', '\u0015pi\r'])

      sendJson(controller, {
        type: 'agent_reexec',
        sessionId: 'session-1',
        operationId: 'operation-missing-epoch',
        provider: 'pi',
        resumeSessionId: null,
        expectedActivity: null,
      })
      const missingEpoch = await waitForMessage<{ operationId: string; status: string }>(
        controller,
        message =>
          message?.type === 'agent_reexec_result' &&
          message.operationId === 'operation-missing-epoch',
      )
      expect(missingEpoch.status).toBe('rejected_stale_authority')
      expect(writes).toHaveLength(2)

      const viewer = new WebSocket(wsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        viewer.once('open', resolvePromise)
        viewer.once('error', rejectPromise)
      })
      sendJson(viewer, { type: 'hello', protocolVersion: 1, client: { kind: 'web' } })
      await waitForMessage(viewer, message => message?.type === 'hello_ack')
      sendJson(viewer, { type: 'attach', sessionId: 'session-1', role: 'viewer' })
      await waitForMessage(viewer, message => message?.type === 'attached')
      sendJson(viewer, {
        type: 'agent_reexec',
        sessionId: 'session-1',
        operationId: 'operation-viewer',
        provider: 'pi',
        resumeSessionId: null,
        expectedActivity: null,
      })
      const rejected = await waitForMessage<{ status: string }>(
        viewer,
        message => message?.type === 'agent_reexec_result',
      )
      expect(rejected.status).toBe('rejected_not_controller')
      expect(writes).toHaveLength(2)
      controller.close()
      viewer.close()
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
