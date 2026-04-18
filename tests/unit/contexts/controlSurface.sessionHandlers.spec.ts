import { describe, expect, it } from 'vitest'
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

describe('control surface session handlers', () => {
  it('returns session.not_found for unknown session ids', async () => {
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
        spawnSession: async () => ({ sessionId: 'pty-1' }),
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
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'session.get',
      payload: { sessionId: 'missing' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('session.not_found')
    }
  })

  it('launches an agent session and returns metadata via session.get', async () => {
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

    let killed: string | null = null
    let spawnedCommand: {
      command: string
      args: string[]
    } | null = null

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
        spawnSession: async input => {
          spawnedCommand = {
            command: input.command,
            args: input.args,
          }
          return { sessionId: 'pty-123' }
        },
        write: () => undefined,
        resize: () => undefined,
        kill: sessionId => {
          killed = sessionId
        },
        onData: () => () => undefined,
        onExit: () => () => undefined,
        attach: () => undefined,
        detach: () => undefined,
        snapshot: () => '',
        startSessionStateWatcher: () => undefined,
        dispose: () => undefined,
      },
      ptyStreamHub: ptyStreamHub as unknown as PtyStreamHub,
    })

    const launched = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: { spaceId: 's1', prompt: 'hello' },
    })

    expect(launched.ok).toBe(true)
    if (!launched.ok) {
      return
    }

    const sessionId = launched.value.sessionId
    expect(sessionId).toBe('pty-123')

    const fetched = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'session.get',
      payload: { sessionId },
    })

    expect(fetched.ok).toBe(true)
    if (fetched.ok) {
      expect(fetched.value.sessionId).toBe('pty-123')
      expect(fetched.value.cwd).toBe('/repo')
      expect(fetched.value.provider).toBe('codex')
      expect('startedAtMs' in fetched.value).toBe(false)
      expect(fetched.value.command).toBe(spawnedCommand?.command)
      expect(fetched.value.args).toEqual(spawnedCommand?.args)
    }

    const killedResult = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.kill',
      payload: { sessionId },
    })

    expect(killedResult.ok).toBe(true)
    expect(killed).toBe('pty-123')
  })

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

  it('rejects invalid providers', async () => {
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
        spawnSession: async () => ({ sessionId: 'pty-1' }),
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
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: { spaceId: 's1', prompt: 'hello', provider: 'nope' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('common.invalid_input')
    }
  })
})
