// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import { createRemotePersistenceStore } from '../../../src/app/main/controlSurface/remote/remotePersistenceStore'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
  disposeAndCleanup,
  invoke,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

describe('Control Surface terminal startup admission', () => {
  it.each(['terminal', 'agent'] as const)(
    'creates a new %s while an old terminal is still recovering',
    async kind => {
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
      let releaseRecovery!: () => void
      const recoveryGate = new Promise<void>(resolveRecovery => {
        releaseRecovery = resolveRecovery
      })
      const ptyRuntime: ControlSurfacePtyRuntime = {
        spawnSession: async options => {
          spawnCalls.push(options.cwd)
          const sessionId = `session-${spawnCalls.length}`
          if (spawnCalls.length === 1) {
            await recoveryGate
          }
          return { sessionId }
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

      let recovery: ReturnType<typeof invoke> | null = null
      let recoverySettled = false
      try {
        const info = await server.ready
        const baseUrl = `http://${info.hostname}:${info.port}`
        recovery = invoke(baseUrl, 'test-token', {
          kind: 'command',
          id: 'session.prepareOrRevive',
          payload: { workspaceId },
        }).then(result => {
          recoverySettled = true
          return result
        })
        await expect.poll(() => spawnCalls.length).toBe(1)

        const admitted = await invoke(baseUrl, 'test-token', {
          kind: 'command',
          id: kind === 'terminal' ? 'session.spawnTerminal' : 'session.launchAgent',
          payload: {
            spaceId,
            cols: 80,
            rows: 24,
            ...(kind === 'agent' ? { provider: 'codex', prompt: '', mode: 'new' } : {}),
          },
        })
        expect(admitted.data).toMatchObject({ ok: true, value: { sessionId: 'session-2' } })
        expect(spawnCalls).toHaveLength(2)
        expect(recoverySettled).toBe(false)
        releaseRecovery()
        const recovered = await recovery
        expect(recovered.data).toMatchObject({
          ok: true,
          value: { nodes: [{ nodeId: 'terminal-node-restart', sessionId: 'session-1' }] },
        })
      } finally {
        releaseRecovery()
        await recovery?.catch(() => undefined)
        const info = await server.ready
        await disposeAndCleanup({
          server,
          userDataPath,
          connectionFilePath,
          baseUrl: `http://${info.hostname}:${info.port}`,
        })
      }
    },
  )

  it.each([
    {
      failure: 'the persistence transport fails',
      createPersistenceStore: () =>
        createRemotePersistenceStore(async () => {
          throw new Error('simulated startup persistence transport failure')
        }),
    },
    {
      failure: 'the persistence transport returns a malformed success value',
      createPersistenceStore: () => {
        const actualFetch = globalThis.fetch
        const fetchWithMalformedRemoteRead: typeof fetch = async (input, init) => {
          if (String(input) === 'http://127.0.0.1:4310/invoke') {
            return new Response(
              JSON.stringify({
                __opencoveControlEnvelope: true,
                ok: true,
                value: { revision: 3, state: {} },
              }),
              { status: 200 },
            )
          }
          return await actualFetch(input, init)
        }
        vi.stubGlobal('fetch', vi.fn(fetchWithMalformedRemoteRead))
        return createRemotePersistenceStore(async () => ({
          hostname: '127.0.0.1',
          port: 4310,
          token: 'test-token',
        }))
      },
    },
  ])('keeps terminal spawn admission closed when $failure', async ({ createPersistenceStore }) => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-terminal-admission-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-terminal-admission-workspace-'))
    const connectionFileName = 'control-surface.terminal-admission.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)
    const workspaceId = randomUUID()
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    const persistenceStore = createPersistenceStore()
    const spawnCalls: string[] = []
    const ptyRuntime: ControlSurfacePtyRuntime = {
      spawnSession: async options => {
        spawnCalls.push(options.cwd)
        throw new Error('spawn must remain blocked during failed startup admission')
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
        id: 'pty.spawn',
        payload: {
          workspaceId,
          cwd: workspacePath,
          cols: 80,
          rows: 24,
          command: process.execPath,
          args: [],
        },
      })

      expect((blocked.data as { error?: { code?: string } }).error?.code).toBe(
        'terminal.runtime_not_ready',
      )
      expect(spawnCalls).toHaveLength(0)
    } finally {
      const info = await server.ready
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://${info.hostname}:${info.port}`,
      })
      vi.unstubAllGlobals()
    }
  })
})
