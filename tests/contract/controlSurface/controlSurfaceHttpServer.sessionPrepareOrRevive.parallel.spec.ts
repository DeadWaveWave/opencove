// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
  disposeAndCleanup,
  invoke,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

function createManyAgentNodeState(options: {
  workspacePath: string
  workspaceId: string
  spaceId: string
  count: number
}) {
  const state = createMinimalState(options.workspacePath, options.workspaceId, options.spaceId)
  const workspace = state.workspaces[0]
  if (!workspace) {
    return state
  }

  workspace.spaces[0]!.nodeIds = Array.from(
    { length: options.count },
    (_, index) => `agent-node-${index + 1}`,
  )
  workspace.nodes = workspace.spaces[0]!.nodeIds.map((nodeId, index) => ({
    id: nodeId,
    title: `codex ${index + 1}`,
    position: { x: index * 40, y: index * 40 },
    width: 520,
    height: 360,
    kind: 'agent',
    sessionId: '',
    status: 'running',
    startedAt: '2026-04-24T10:00:00.000Z',
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    executionDirectory: options.workspacePath,
    expectedDirectory: options.workspacePath,
    agent: {
      provider: 'codex',
      prompt: 'recover agent',
      model: 'gpt-5.2-codex',
      effectiveModel: 'gpt-5.2-codex',
      launchMode: 'resume',
      resumeSessionId: `resume-session-${index + 1}`,
      resumeSessionIdVerified: true,
      executionDirectory: options.workspacePath,
      expectedDirectory: options.workspacePath,
      directoryMode: 'workspace',
      customDirectory: null,
      shouldCreateDirectory: false,
      taskId: null,
    },
    task: null,
  }))

  return state
}

describe('Control Surface HTTP server (session.prepareOrRevive parallel restore)', () => {
  it('prepares multiple agent restores concurrently instead of serializing every spawn', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-workspace-'))
    const connectionFileName = 'control-surface.pty.prepare-or-revive.parallel.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    let releaseFirstSpawn: (() => void) | null = null
    const firstSpawnGate = new Promise<void>(resolveGate => {
      releaseFirstSpawn = resolveGate
    })
    const spawnCalls: Array<{ cwd: string }> = []
    const ptyRuntime: ControlSurfacePtyRuntime = {
      spawnSession: async options => {
        spawnCalls.push({ cwd: options.cwd })
        const callIndex = spawnCalls.length
        if (callIndex === 1) {
          await firstSpawnGate
        }
        return { sessionId: `agent-session-${callIndex}` }
      },
      write: () => undefined,
      resize: () => undefined,
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
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime,
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const workspaceId = randomUUID()
      const spaceId = randomUUID()

      const writeState = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: {
          state: createManyAgentNodeState({
            workspacePath,
            workspaceId,
            spaceId,
            count: 2,
          }),
        },
      })
      expect(writeState.status, JSON.stringify(writeState.data)).toBe(200)

      const preparedPromise = invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId },
      })

      await expect.poll(() => spawnCalls.length, { timeout: 1_000 }).toBeGreaterThanOrEqual(2)

      releaseFirstSpawn?.()
      const prepared = await preparedPromise
      expect(prepared.status, JSON.stringify(prepared.data)).toBe(200)
    } finally {
      releaseFirstSpawn?.()
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })
})
