import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerPtyMountHandlers } from '../../../src/app/main/controlSurface/handlers/ptyMountHandlers'
import { registerSessionStreamingHandlers } from '../../../src/app/main/controlSurface/handlers/sessionStreamingHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-05-10T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: {
      state: true,
      events: true,
    },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 400_000,
      roles: {
        viewer: true,
        controller: true,
      },
      webAuth: {
        ticketToCookie: true,
        cookieSession: true,
      },
    },
  },
}

function createStubStore(state: unknown) {
  return {
    readWorkspaceStateRaw: async () => null,
    writeWorkspaceStateRaw: async () => ({ ok: true, level: 'full', bytes: 0 }),
    readAppState: async () => state,
    writeAppState: async () => ({ ok: true, level: 'full', bytes: 1 }),
    readNodeScrollback: async () => null,
    writeNodeScrollback: async () => ({ ok: true, level: 'full', bytes: 0 }),
    consumeRecovery: () => null,
    dispose: () => undefined,
  }
}

function createPtyStreamHubStub() {
  const sessions = new Map<
    string,
    {
      sessionId: string
      kind: 'agent' | 'terminal'
      startedAt: string
      cwd: string
      command: string
      args: string[]
      cols: number
      rows: number
    }
  >()

  return {
    registerSessionMetadata: (metadata: typeof sessions extends Map<string, infer T> ? T : never) =>
      sessions.set(metadata.sessionId, metadata),
    listSessions: () => ({
      sessions: [...sessions.values()].map(session => ({
        sessionId: session.sessionId,
        kind: session.kind,
        startedAt: session.startedAt,
        cwd: session.cwd,
        command: session.command,
        args: session.args,
        status: 'running' as const,
        exitCode: null,
        seq: 0,
        earliestSeq: 0,
        controller: null,
      })),
    }),
  }
}

describe('control surface session streaming handlers', () => {
  it('routes session.spawnTerminal through pty.spawnInMount for mounted spaces', async () => {
    const rootPath = path.join(process.cwd(), '.tmp-mounted-repo')
    const worktreePath = path.join(rootPath, 'worktrees', 'feature-b')
    const rootUri = pathToFileURL(rootPath).href
    const worktreeUri = pathToFileURL(worktreePath).href
    const appState = {
      formatVersion: 1,
      activeWorkspaceId: 'ws1',
      workspaces: [
        {
          id: 'ws1',
          name: 'Workspace',
          path: rootPath,
          worktreesRoot: '',
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [
            {
              id: 's1',
              name: 'Space A',
              directoryPath: '/repo',
              targetMountId: 'mount-1',
              boundary: {
                allowedMountIds: ['mount-1'],
                scopesByMountId: {
                  'mount-1': {
                    rootPath: worktreePath,
                    rootUri: worktreeUri,
                  },
                },
                allowedPluginIds: null,
                capabilities: null,
                trustLevel: null,
              },
              labelColor: null,
              nodeIds: [],
              rect: null,
            },
          ],
          activeSpaceId: null,
          nodes: [],
          spaceArchiveRecords: [],
        },
      ],
      settings: {},
    }

    let spawnedInput: {
      cwd: string
      cols: number
      rows: number
      command: string
      args: string[]
    } | null = null

    const ptyStreamHub = createPtyStreamHubStub()
    const controlSurface = createControlSurface()
    const topology = {
      listMounts: async () => ({
        projectId: 'ws1',
        mounts: [
          {
            mountId: 'mount-1',
            projectId: 'ws1',
            name: 'Primary',
            sortOrder: 0,
            endpointId: 'local',
            targetId: 'target-1',
            rootPath,
            rootUri,
            createdAt: '2026-05-10T00:00:00.000Z',
            updatedAt: '2026-05-10T00:00:00.000Z',
          },
        ],
      }),
      resolveMountTarget: async () => ({
        mountId: 'mount-1',
        endpointId: 'local',
        targetId: 'target-1',
        rootPath,
        rootUri,
      }),
    } as never

    registerPtyMountHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      topology,
      ptyRuntime: {
        spawnSession: async input => {
          spawnedInput = input
          return { sessionId: 'pty-mounted-terminal' }
        },
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
        attach: () => undefined,
        detach: () => undefined,
        snapshot: () => '',
        registerRemoteSession: () => 'remote-home-session',
        dispose: () => undefined,
      },
      ptyStreamHub: ptyStreamHub as unknown as PtyStreamHub,
    })

    registerSessionStreamingHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      getPersistenceStore: async () => createStubStore(appState),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'unused' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
        attach: () => undefined,
        detach: () => undefined,
        snapshot: () => '',
        dispose: () => undefined,
      },
      ptyStreamHub: ptyStreamHub as unknown as PtyStreamHub,
      topology,
    })

    const spawned = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.spawnTerminal',
      payload: { spaceId: 's1' },
    })

    expect(spawned.ok).toBe(true)
    if (!spawned.ok || !spawnedInput) {
      return
    }

    expect(spawnedInput.cwd).toBe(worktreePath)
    expect(spawned.value.cwd).toBe(worktreePath)
    expect(spawned.value.command).toBe(spawnedInput.command)
    expect(spawned.value.args).toEqual(spawnedInput.args)
    expect(spawned.value.executionContext).toMatchObject({
      projectId: 'ws1',
      spaceId: 's1',
      mountId: 'mount-1',
      targetId: 'target-1',
      workingDirectory: worktreePath,
      target: {
        rootPath,
        rootUri,
      },
      scope: {
        rootPath: worktreePath,
        rootUri: worktreeUri,
      },
      endpoint: {
        endpointId: 'local',
        kind: 'local',
      },
    })
  })
})
