// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
  disposeAndCleanup,
  invoke,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

describe('Control Surface terminal startup admission', () => {
  it('blocks normal spawn until restart reconciliation finishes while allowing only recovery spawn', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-terminal-admission-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-terminal-admission-workspace-'))
    const connectionFileName = 'control-surface.terminal-admission.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)
    const workspaceId = randomUUID()
    const spaceId = randomUUID()
    const state = createMinimalState(workspacePath, workspaceId, spaceId)
    const workspace = state.workspaces[0]!
    workspace.spaces[0]!.nodeIds = ['terminal-node-restart']
    workspace.nodes = [
      {
        id: 'terminal-node-restart',
        title: 'Recovering shell',
        position: { x: 0, y: 0 },
        width: 480,
        height: 320,
        kind: 'terminal',
        sessionId: 'stale-session-before-worker-restart',
        status: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: 'durable terminal history',
        executionDirectory: workspacePath,
        expectedDirectory: workspacePath,
        agent: null,
        task: null,
      },
    ]

    const persistenceStore = createInMemoryPersistenceStore()
    await persistenceStore.writeAppState(state)
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    const spawnCalls: string[] = []
    const ptyRuntime: ControlSurfacePtyRuntime = {
      spawnSession: async options => {
        spawnCalls.push(options.cwd)
        return { sessionId: `session-${spawnCalls.length}` }
      },
      write: () => undefined,
      resize: async input => ({
        sessionId: input.sessionId,
        operationId: input.operationId ?? 'test-resize',
        status: 'accepted',
        changed: true,
        geometry: { cols: input.cols, rows: input.rows, revision: null },
        authority: null,
      }),
      kill: () => undefined,
      onData: () => () => undefined,
      onExit: () => () => undefined,
    }

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'test-token',
      connectionFileName,
      approvedWorkspaces,
      createPersistenceStore: async () => persistenceStore,
      ptyRuntime,
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const blocked = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'session.spawnTerminal',
        payload: { spaceId, cols: 80, rows: 24 },
      })
      expect((blocked.data as { error?: { code?: string } }).error?.code).toBe(
        'terminal.runtime_not_ready',
      )
      expect(spawnCalls).toHaveLength(0)

      const recovered = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId },
      })
      expect((recovered.data as { ok?: boolean }).ok).toBe(true)
      expect(spawnCalls).toHaveLength(1)

      const admitted = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'session.spawnTerminal',
        payload: { spaceId, cols: 80, rows: 24 },
      })
      expect((admitted.data as { ok?: boolean }).ok).toBe(true)
      expect(spawnCalls).toHaveLength(2)
    } finally {
      const info = await server.ready
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://${info.hostname}:${info.port}`,
      })
    }
  })
})
