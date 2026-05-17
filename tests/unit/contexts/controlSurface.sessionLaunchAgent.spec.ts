import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-03-27T00:00:00.000Z'),
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

function createTopologyStub() {
  return {
    listMounts: async () => ({ projectId: 'ws1', mounts: [] }),
  } as never
}

describe('control surface session launch agent', () => {
  it('allows launching agent sessions with an empty prompt', async () => {
    const appState = {
      formatVersion: 1,
      activeWorkspaceId: 'ws1',
      workspaces: [
        {
          id: 'ws1',
          name: 'Workspace',
          path: '/repo',
          worktreesRoot: '',
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [
            {
              id: 's1',
              name: 'Space A',
              directoryPath: '/repo',
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

    const controlSurface = createControlSurface()
    const ptyStreamHub: Pick<PtyStreamHub, 'registerSessionMetadata' | 'hasSession'> = {
      registerSessionMetadata: () => undefined,
      hasSession: () => false,
    }

    registerSessionHandlers(controlSurface, {
      userDataPath: '/tmp/opencove-test-user-data',
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      getPersistenceStore: async () => createStubStore(appState),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'pty-empty-prompt' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
        attach: () => undefined,
        detach: () => undefined,
        snapshot: () => '',
        startSessionStateWatcher: () => undefined,
        dispose: () => undefined,
      },
      ptyStreamHub: ptyStreamHub as unknown as PtyStreamHub,
      topology: createTopologyStub(),
    })

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: { spaceId: 's1', prompt: '' },
    })

    expect(launched.ok).toBe(true)
    if (!launched.ok) {
      return
    }

    expect(launched.value.sessionId).toBe('pty-empty-prompt')

    const fetched = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'session.get',
      payload: { sessionId: launched.value.sessionId },
    })

    expect(fetched.ok).toBe(true)
    if (fetched.ok) {
      expect(fetched.value.prompt).toBe('')
    }
  })

  it('launches an agent session by cwd when no spaces exist', async () => {
    const appState = {
      formatVersion: 1,
      activeWorkspaceId: 'ws1',
      workspaces: [
        {
          id: 'ws1',
          name: 'Workspace',
          path: '/repo',
          worktreesRoot: '',
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [],
          activeSpaceId: null,
          nodes: [],
          spaceArchiveRecords: [],
        },
      ],
      settings: {},
    }

    const controlSurface = createControlSurface()
    const ptyStreamHub: Pick<PtyStreamHub, 'registerSessionMetadata' | 'hasSession'> = {
      registerSessionMetadata: () => undefined,
      hasSession: () => false,
    }

    registerSessionHandlers(controlSurface, {
      userDataPath: '/tmp/opencove-test-user-data',
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      getPersistenceStore: async () => createStubStore(appState),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'pty-cwd' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
        attach: () => undefined,
        detach: () => undefined,
        snapshot: () => '',
        startSessionStateWatcher: () => undefined,
        dispose: () => undefined,
      },
      ptyStreamHub: ptyStreamHub as unknown as PtyStreamHub,
      topology: createTopologyStub(),
    })

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: { cwd: '/repo', prompt: 'hello' },
    })

    expect(launched.ok).toBe(true)
    if (!launched.ok) {
      return
    }

    expect(launched.value.sessionId).toBe('pty-cwd')

    const fetched = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'session.get',
      payload: { sessionId: launched.value.sessionId },
    })

    expect(fetched.ok).toBe(true)
    if (fetched.ok) {
      expect(fetched.value.cwd).toBe('/repo')
    }
  })

  it('routes space-based agent launches through session.launchAgentInMount when the space resolves to a mount', async () => {
    const rootPath = path.join(process.cwd(), '.tmp-mounted-repo')
    const worktreePath = path.join(rootPath, 'worktrees', 'feature-a')
    const rootUri = pathToFileURL(rootPath).href
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
              id: 's-mounted',
              name: 'Mounted Space',
              directoryPath: worktreePath,
              targetMountId: 'mount-1',
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

    const spawnSession = vi.fn(async input => {
      expect(input.cwd).toBe(worktreePath)
      return { sessionId: 'pty-mounted' }
    })
    const controlSurface = createControlSurface()
    registerSessionHandlers(controlSurface, {
      userDataPath: '/tmp/opencove-test-user-data',
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      getPersistenceStore: async () => createStubStore(appState),
      ptyRuntime: {
        spawnSession,
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
        attach: () => undefined,
        detach: () => undefined,
        snapshot: () => '',
        startSessionStateWatcher: () => undefined,
        registerRemoteSession: () => 'remote-home-session',
        dispose: () => undefined,
      },
      ptyStreamHub: {
        registerSessionMetadata: () => undefined,
        hasSession: () => false,
      } as unknown as PtyStreamHub,
      topology: {
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
              createdAt: '2026-03-27T00:00:00.000Z',
              updatedAt: '2026-03-27T00:00:00.000Z',
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
      } as never,
    })

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: { spaceId: 's-mounted', prompt: 'hello from mount' },
    })

    expect(launched.ok).toBe(true)
    if (!launched.ok) {
      return
    }

    expect(spawnSession).toHaveBeenCalledTimes(1)
    expect(launched.value.executionContext).toMatchObject({
      projectId: 'ws1',
      spaceId: 's-mounted',
      mountId: 'mount-1',
      targetId: 'target-1',
      workingDirectory: worktreePath,
      target: {
        rootPath,
        rootUri,
      },
      scope: {
        rootPath,
        rootUri,
      },
      endpoint: {
        endpointId: 'local',
        kind: 'local',
      },
    })

    const fetched = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'session.get',
      payload: { sessionId: launched.value.sessionId },
    })

    expect(fetched.ok).toBe(true)
    if (fetched.ok) {
      expect(fetched.value.executionContext.projectId).toBe('ws1')
      expect(fetched.value.executionContext.spaceId).toBe('s-mounted')
      expect(fetched.value.executionContext.mountId).toBe('mount-1')
    }
  })
})
