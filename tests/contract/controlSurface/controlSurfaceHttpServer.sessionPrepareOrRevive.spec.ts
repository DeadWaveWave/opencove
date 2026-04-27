// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
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

function createTerminalNodeState(options: {
  workspacePath: string
  workspaceId: string
  spaceId: string
  sessionId: string
}) {
  const state = createMinimalState(options.workspacePath, options.workspaceId, options.spaceId)
  const workspace = state.workspaces[0]
  if (!workspace) {
    return state
  }

  workspace.spaces[0]!.nodeIds = ['terminal-node-1']
  workspace.nodes = [
    {
      id: 'terminal-node-1',
      title: 'Shell',
      position: { x: 0, y: 0 },
      width: 480,
      height: 320,
      kind: 'terminal',
      sessionId: options.sessionId,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: 'persisted shell output',
      executionDirectory: options.workspacePath,
      expectedDirectory: options.workspacePath,
      agent: null,
      task: null,
    },
  ]

  return state
}

function createAgentNodeState(options: {
  workspacePath: string
  workspaceId: string
  spaceId: string
}) {
  const state = createMinimalState(options.workspacePath, options.workspaceId, options.spaceId)
  const workspace = state.workspaces[0]
  if (!workspace) {
    return state
  }

  workspace.environmentVariables = {
    OPENAI_API_KEY: 'worker-restore-key',
  }
  workspace.spaces[0]!.nodeIds = ['agent-node-1']
  workspace.nodes = [
    {
      id: 'agent-node-1',
      title: 'codex · gpt-5.2-codex',
      position: { x: 0, y: 0 },
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
        resumeSessionId: 'resume-session-1',
        resumeSessionIdVerified: true,
        executionDirectory: options.workspacePath,
        expectedDirectory: options.workspacePath,
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
      task: null,
    },
  ]

  return state
}

describe('Control Surface HTTP server (session.prepareOrRevive)', () => {
  it('reuses live worker sessions without spawning a replacement session', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-workspace-'))
    const connectionFileName = 'control-surface.pty.prepare-or-revive.live.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    const spawnCalls: Array<{ cwd: string; env?: NodeJS.ProcessEnv; cols: number; rows: number }> =
      []
    let sessionCounter = 0
    const ptyRuntime: ControlSurfacePtyRuntime = {
      spawnSession: async options => {
        spawnCalls.push({ cwd: options.cwd, env: options.env })
        sessionCounter += 1
        return { sessionId: `test-session-${sessionCounter}` }
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

      const writeInitialState = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: createMinimalState(workspacePath, workspaceId, spaceId) },
      })
      expect(writeInitialState.status, JSON.stringify(writeInitialState.data)).toBe(200)
      const baseRevision = (writeInitialState.data as { value?: { revision?: number } })?.value
        ?.revision
      expect(typeof baseRevision).toBe('number')

      const spawnResult = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'session.spawnTerminal',
        payload: {
          spaceId,
          runtime: 'node',
          command: process.execPath,
          args: ['-e', "process.stdout.write('hello from live session\\n')"],
          cols: 80,
          rows: 24,
        },
      })
      expect(spawnResult.status, JSON.stringify(spawnResult.data)).toBe(200)
      const liveSessionId = (spawnResult.data as { value?: { sessionId?: string } })?.value
        ?.sessionId
      expect(typeof liveSessionId).toBe('string')

      const writeNodeState = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: {
          baseRevision,
          state: createTerminalNodeState({
            workspacePath,
            workspaceId,
            spaceId,
            sessionId: liveSessionId as string,
          }),
        },
      })
      expect(writeNodeState.status, JSON.stringify(writeNodeState.data)).toBe(200)

      const prepared = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId },
      })
      expect(prepared.status, JSON.stringify(prepared.data)).toBe(200)

      const preparedNode = (
        prepared.data as {
          ok?: boolean
          value?: { nodes?: Array<{ recoveryState?: string; sessionId?: string }> }
        }
      )?.value?.nodes?.[0]
      expect(preparedNode?.recoveryState).toBe('live')
      expect(preparedNode?.sessionId).toBe(liveSessionId)
      expect(spawnCalls).toHaveLength(1)
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })

  it('revives agent nodes through the worker path and preserves workspace env', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-workspace-'))
    const connectionFileName = 'control-surface.pty.prepare-or-revive.agent.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    const spawnCalls: Array<{ cwd: string; env?: NodeJS.ProcessEnv }> = []
    let sessionCounter = 0
    const ptyRuntime: ControlSurfacePtyRuntime = {
      spawnSession: async options => {
        spawnCalls.push({
          cwd: options.cwd,
          env: options.env,
          cols: options.cols,
          rows: options.rows,
        })
        sessionCounter += 1
        return { sessionId: `agent-session-${sessionCounter}` }
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
        payload: { state: createAgentNodeState({ workspacePath, workspaceId, spaceId }) },
      })
      expect(writeState.status, JSON.stringify(writeState.data)).toBe(200)

      const prepared = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId },
      })
      expect(prepared.status, JSON.stringify(prepared.data)).toBe(200)

      const preparedNode = (
        prepared.data as {
          ok?: boolean
          value?: {
            nodes?: Array<{
              recoveryState?: string
              status?: string | null
              sessionId?: string
              agent?: { resumeSessionId?: string | null; resumeSessionIdVerified?: boolean }
            }>
          }
        }
      )?.value?.nodes?.[0]

      expect(preparedNode?.recoveryState).toBe('revived')
      expect(preparedNode?.status).toBe('standby')
      expect(preparedNode?.sessionId).toBe('agent-session-1')
      expect(preparedNode?.agent?.resumeSessionId).toBe('resume-session-1')
      expect(preparedNode?.agent?.resumeSessionIdVerified).toBe(true)
      expect(spawnCalls[0]?.env?.OPENAI_API_KEY).toBe('worker-restore-key')
      expect(spawnCalls[0]?.cols).toBeGreaterThan(40)
      expect(spawnCalls[0]?.rows).toBeGreaterThan(10)
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })

  it('does not return durable agent placeholder scrollback as a renderer restore baseline', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-workspace-'))
    const connectionFileName = 'control-surface.pty.prepare-or-revive.agent-scrollback.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    const persistenceStore = createInMemoryPersistenceStore()

    const ptyRuntime: ControlSurfacePtyRuntime = {
      spawnSession: async () => ({ sessionId: 'agent-session-1' }),
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
      createPersistenceStore: async () => persistenceStore,
      ptyRuntime,
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const workspaceId = randomUUID()
      const spaceId = randomUUID()

      await persistenceStore.writeAgentNodePlaceholderScrollback(
        'agent-node-1',
        'durable placeholder history from worker store',
      )

      const state = createAgentNodeState({ workspacePath, workspaceId, spaceId })
      state.workspaces[0]!.nodes[0]!.scrollback = 'legacy agent renderer cache'
      const writeState = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state },
      })
      expect(writeState.status, JSON.stringify(writeState.data)).toBe(200)

      const prepared = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId },
      })
      expect(prepared.status, JSON.stringify(prepared.data)).toBe(200)

      const preparedNode = (
        prepared.data as {
          value?: {
            nodes?: Array<{
              scrollback?: string | null
            }>
          }
        }
      )?.value?.nodes?.[0]

      expect(preparedNode?.scrollback).toBeNull()
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
