import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

const { captureGeminiSessionDiscoveryCursorMock } = vi.hoisted(() => ({
  captureGeminiSessionDiscoveryCursorMock: vi.fn(),
}))

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentSessionLocatorProviders', () => ({
  captureGeminiSessionDiscoveryCursor: captureGeminiSessionDiscoveryCursorMock,
}))

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-03-27T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: { state: true, events: true },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 400_000,
      roles: { viewer: true, controller: true },
      webAuth: { ticketToCookie: true, cookieSession: true },
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

describe('control surface session handler watchers', () => {
  it('starts the session state watcher for session.launchAgent when test watcher mode is enabled', async () => {
    const previousFlag = process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER
    process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER = '1'

    try {
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

      const startSessionStateWatcher = vi.fn()
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
          spawnSession: async () => ({ sessionId: 'pty-watch' }),
          write: () => undefined,
          resize: () => undefined,
          kill: () => undefined,
          onData: () => () => undefined,
          onExit: () => () => undefined,
          attach: () => undefined,
          detach: () => undefined,
          snapshot: () => '',
          startSessionStateWatcher,
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
      expect(startSessionStateWatcher).toHaveBeenCalledTimes(1)
      expect(startSessionStateWatcher).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'pty-watch',
          provider: 'codex',
          cwd: '/repo',
          launchMode: 'new',
          resumeSessionId: null,
        }),
      )
    } finally {
      if (previousFlag === undefined) {
        delete process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER
      } else {
        process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER = previousFlag
      }
    }
  })

  it('captures the Gemini discovery cursor before starting the session state watcher', async () => {
    const previousFlag = process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER
    process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER = '1'

    try {
      captureGeminiSessionDiscoveryCursorMock.mockResolvedValue({
        entriesByFilePath: {
          '/repo/.gemini/chats/session-existing.json': {
            signature: 'existing-signature',
            hadRelevantTurn: true,
          },
        },
      })
      const startSessionStateWatcher = vi.fn()
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
        getPersistenceStore: async () => createStubStore({ settings: {} }),
        ptyRuntime: {
          spawnSession: async () => ({ sessionId: 'pty-gemini-watch' }),
          write: () => undefined,
          resize: () => undefined,
          kill: () => undefined,
          onData: () => () => undefined,
          onExit: () => () => undefined,
          attach: () => undefined,
          detach: () => undefined,
          snapshot: () => '',
          startSessionStateWatcher,
          dispose: () => undefined,
        },
        ptyStreamHub: ptyStreamHub as unknown as PtyStreamHub,
      })

      const launched = await controlSurface.invoke(ctx, {
        kind: 'command',
        id: 'session.launchAgent',
        payload: {
          cwd: '/repo',
          prompt: 'hello',
          provider: 'gemini',
          model: 'gemini-3-flash-preview',
        },
      })

      expect(launched.ok).toBe(true)
      expect(captureGeminiSessionDiscoveryCursorMock).toHaveBeenCalledWith('/repo')
      expect(startSessionStateWatcher).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'pty-gemini-watch',
          provider: 'gemini',
          geminiDiscoveryCursor: {
            entriesByFilePath: {
              '/repo/.gemini/chats/session-existing.json': {
                signature: 'existing-signature',
                hadRelevantTurn: true,
              },
            },
          },
        }),
      )
    } finally {
      if (previousFlag === undefined) {
        delete process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER
      } else {
        process.env.OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER = previousFlag
      }
    }
  })
})
