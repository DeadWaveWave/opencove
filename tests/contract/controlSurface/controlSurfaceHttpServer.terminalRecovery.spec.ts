// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import WebSocket from 'ws'
import { expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import {
  createMinimalState,
  invoke,
  safeRemoveDirectory,
  sendJson,
  toWsUrl,
  waitForMessage,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'
import { describeWithElectronNativeModules } from '../electronNativeSuite'

describeWithElectronNativeModules('Control Surface terminal recovery durability', () => {
  it('binds persisted terminal nodes and flushes worker-owned output before shutdown', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-terminal-recovery-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-terminal-recovery-workspace-'))
    const dbPath = resolve(userDataPath, 'opencove.db')
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    let emitData: ((event: { sessionId: string; data: string }) => void) | null = null
    let resolveResize: (() => void) | null = null
    let notifyResizeStarted: (() => void) | null = null
    const resizeStarted = new Promise<void>(resolvePromise => {
      notifyResizeStarted = resolvePromise
    })
    const ptyRuntime: ControlSurfacePtyRuntime = {
      spawnSession: async () => ({ sessionId: 'terminal-recovery-session' }),
      write: (sessionId, data) => {
        emitData?.({ sessionId, data })
      },
      resize: async input =>
        await new Promise(resolvePromise => {
          notifyResizeStarted?.()
          resolveResize = () => {
            resolvePromise({
              sessionId: input.sessionId,
              operationId: input.operationId ?? 'test-resize',
              status: 'accepted',
              changed: true,
              geometry: { cols: input.cols, rows: input.rows, revision: 1 },
              authority: null,
            })
          }
        }),
      kill: () => undefined,
      onData: listener => {
        emitData = listener
        return () => {
          emitData = null
        }
      },
      onExit: () => () => undefined,
    }
    const server = registerControlSurfaceHttpServer({
      userDataPath,
      dbPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'terminal-recovery-token',
      approvedWorkspaces,
      ptyRuntime,
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const wsUrl = toWsUrl(baseUrl, '/pty', { token: 'terminal-recovery-token' })
      const workspaceId = randomUUID()
      const spaceId = randomUUID()
      const state = createMinimalState(workspacePath, workspaceId, spaceId)
      state.workspaces[0]!.spaces[0]!.nodeIds = ['terminal-recovery-node']
      state.workspaces[0]!.nodes = [
        {
          id: 'terminal-recovery-node',
          sessionId: null,
          title: 'Shell',
          position: { x: 0, y: 0 },
          width: 520,
          height: 360,
          kind: 'terminal',
          profileId: null,
          runtimeKind: 'posix',
          terminalGeometry: { cols: 80, rows: 24 },
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          executionDirectory: workspacePath,
          expectedDirectory: workspacePath,
          agent: null,
          task: null,
        },
      ]
      const initialWrite = await invoke(baseUrl, 'terminal-recovery-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state },
      })
      expect(initialWrite.status).toBe(200)
      const baseRevision = (initialWrite.data as { value?: { revision?: number } }).value?.revision
      const legacyWrite = await invoke(baseUrl, 'terminal-recovery-token', {
        kind: 'command',
        id: 'sync.writeNodeScrollback',
        payload: { nodeId: 'terminal-recovery-node', scrollback: 'LEGACY_HISTORY\r\n' },
      })
      expect(legacyWrite.status).toBe(200)

      const spawn = await invoke(baseUrl, 'terminal-recovery-token', {
        kind: 'command',
        id: 'pty.spawn',
        payload: {
          cwd: workspacePath,
          command: process.execPath,
          args: ['-e', ''],
          cols: 80,
          rows: 24,
        },
      })
      expect(spawn.status).toBe(200)
      const sessionId = (spawn.data as { value?: { sessionId?: string } }).value?.sessionId
      expect(sessionId).toBe('terminal-recovery-session')

      state.workspaces[0]!.nodes[0]!.sessionId = sessionId
      const nodeWrite = await invoke(baseUrl, 'terminal-recovery-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state, baseRevision },
      })
      expect(nodeWrite.status, JSON.stringify(nodeWrite.data)).toBe(200)

      const staleRendererWrite = await invoke(baseUrl, 'terminal-recovery-token', {
        kind: 'command',
        id: 'sync.writeNodeScrollback',
        payload: { nodeId: 'terminal-recovery-node', scrollback: 'STALE_RENDERER_CACHE' },
      })
      expect(staleRendererWrite.status).toBe(200)

      emitData?.({ sessionId: sessionId!, data: 'WORKER_OWNED_OUTPUT\r\n' })
      const controller = new WebSocket(wsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        controller.once('open', resolvePromise)
        controller.once('error', rejectPromise)
      })
      sendJson(controller, { type: 'hello', protocolVersion: 1, client: { kind: 'cli' } })
      await waitForMessage(controller, (message): message is { type: string } =>
        Boolean(
          message &&
          typeof message === 'object' &&
          (message as { type?: unknown }).type === 'hello_ack',
        ),
      )
      sendJson(controller, { type: 'attach', sessionId, role: 'controller' })
      await waitForMessage(controller, (message): message is { type: string } =>
        Boolean(
          message &&
          typeof message === 'object' &&
          (message as { type?: unknown }).type === 'attached',
        ),
      )
      sendJson(controller, {
        type: 'resize',
        sessionId,
        cols: 120,
        rows: 40,
        reason: 'frame_commit',
        operationId: 'shutdown-racing-resize',
      })
      await resizeStarted
      const queuedWriteToken = 'QUEUED_WRITE_AFTER_PENDING_RESIZE\r\n'
      sendJson(controller, { type: 'write', sessionId, data: queuedWriteToken })
      await new Promise(resolvePromise => setImmediate(resolvePromise))

      let disposeResolved = false
      const dispose = server.dispose().then(() => {
        disposeResolved = true
      })
      await Promise.resolve()
      expect(disposeResolved).toBe(false)
      resolveResize?.()
      await dispose

      const db = new Database(dbPath, { readonly: true })
      try {
        const row = db
          .prepare(
            `SELECT generation, checkpoint_revision, presentation_json, raw_tail
             FROM terminal_recovery_records WHERE node_id = ?`,
          )
          .get('terminal-recovery-node') as
          | {
              generation: number
              checkpoint_revision: number
              presentation_json: string
              raw_tail: string
            }
          | undefined
        expect(row?.generation).toBe(1)
        expect(row?.checkpoint_revision).toBeGreaterThanOrEqual(2)
        expect(row?.presentation_json).toContain('WORKER_OWNED_OUTPUT')
        expect(row?.presentation_json).toContain('LEGACY_HISTORY')
        expect(row?.raw_tail).not.toContain('LEGACY_HISTORY')
        expect(row?.raw_tail).toContain('WORKER_OWNED_OUTPUT')
        expect(row?.presentation_json).toContain('QUEUED_WRITE_AFTER_PENDING_RESIZE')
        expect(row?.raw_tail).toContain('QUEUED_WRITE_AFTER_PENDING_RESIZE')
        expect(row?.raw_tail).not.toContain('STALE_RENDERER_CACHE')
        const presentation = JSON.parse(row?.presentation_json ?? 'null') as {
          cols?: unknown
          rows?: unknown
          geometryRevision?: unknown
        } | null
        expect(presentation).toMatchObject({ cols: 120, rows: 40, geometryRevision: 1 })
      } finally {
        db.close()
      }

      const reopenedStore = await createPersistenceStore({ dbPath })
      try {
        const recoveredScrollback = await reopenedStore.readNodeScrollback('terminal-recovery-node')
        expect(recoveredScrollback).toContain('LEGACY_HISTORY')
        expect(recoveredScrollback).toContain('WORKER_OWNED_OUTPUT')
      } finally {
        reopenedStore.dispose()
      }
    } finally {
      await server.dispose()
      await safeRemoveDirectory(userDataPath)
      await safeRemoveDirectory(workspacePath)
    }
  })
})
