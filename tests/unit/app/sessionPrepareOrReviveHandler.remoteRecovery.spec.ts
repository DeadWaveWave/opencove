import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionPrepareOrReviveHandler } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveHandler'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-07-10T00:00:00.000Z'),
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

function createRemoteRecoveryStore() {
  return {
    readAppState: async () => ({
      formatVersion: 1,
      activeWorkspaceId: 'workspace-1',
      settings: {},
      workspaces: [
        {
          id: 'workspace-1',
          name: 'Workspace',
          path: '/tmp/workspace',
          worktreesRoot: '',
          pullRequestBaseBranchOptions: [],
          environmentVariables: {},
          spaceArchiveRecords: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          activeSpaceId: null,
          spaces: [],
          nodes: [
            {
              id: 'terminal-1',
              sessionId: 'home-session-1',
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
              scrollback: 'durable history',
              executionDirectory: '/tmp/workspace',
              expectedDirectory: '/tmp/workspace',
              agent: null,
              task: null,
            },
          ],
        },
      ],
    }),
    readNodeScrollback: async () => 'worker checkpoint',
  } as never
}

describe('session.prepareOrRevive remote terminal recovery', () => {
  it('reattaches a persisted remote route before deciding to spawn a replacement shell', async () => {
    let active = false
    const restoreTerminalSession = vi.fn(async () => {
      active = true
      return true
    })
    const controlSurface = createControlSurface()
    registerSessionPrepareOrReviveHandler(controlSurface, {
      getPersistenceStore: async () => createRemoteRecoveryStore(),
      ptyStreamHub: {
        isSessionActive: vi.fn(() => active),
      } as never,
      restoreTerminalSession,
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'workspace-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(restoreTerminalSession).toHaveBeenCalledWith({
      nodeId: 'terminal-1',
      sessionId: 'home-session-1',
    })
    expect(result.value).toMatchObject({
      nodes: [
        {
          nodeId: 'terminal-1',
          sessionId: 'home-session-1',
          recoveryState: 'live',
          isLiveSessionReattach: true,
          scrollback: 'worker checkpoint',
        },
      ],
    })
  })

  it('does not spawn a replacement when remote recovery rejects transiently', async () => {
    const restoreTerminalSession = vi.fn(async () => {
      throw new Error('temporary remote recovery failure')
    })
    const controlSurface = createControlSurface()
    registerSessionPrepareOrReviveHandler(controlSurface, {
      getPersistenceStore: async () => createRemoteRecoveryStore(),
      ptyStreamHub: {
        isSessionActive: vi.fn(() => false),
      } as never,
      restoreTerminalSession,
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'workspace-1' },
    })

    expect(result.ok).toBe(false)
    expect(restoreTerminalSession).toHaveBeenCalledTimes(1)
    if (!result.ok) {
      expect(result.error.debugMessage).toContain('temporary remote recovery failure')
    }
  })
})
