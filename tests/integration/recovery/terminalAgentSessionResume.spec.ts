import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionPrepareOrReviveHandler } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveHandler'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { createReadyTerminalAdmissionDeps } from '../../unit/contexts/controlSurfaceTestTerminalAvailability'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-08-13T00:00:00.000Z'),
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

function createStore(binding: {
  resumeSessionId: string | null
  resumeSessionIdVerified: boolean
}) {
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
              id: 'terminal-agent-1',
              sessionId: 'stale-pty-session',
              title: 'codex',
              position: { x: 0, y: 0 },
              width: 520,
              height: 360,
              kind: 'terminal',
              profileId: null,
              runtimeKind: 'posix',
              terminalGeometry: { cols: 80, rows: 24 },
              terminalProviderHint: 'codex',
              status: null,
              startedAt: null,
              endedAt: null,
              exitCode: null,
              lastError: null,
              scrollback: 'durable terminal history',
              executionDirectory: '/tmp/workspace',
              expectedDirectory: '/tmp/workspace',
              agent: { provider: 'codex', ...binding },
              task: null,
            },
          ],
        },
      ],
    }),
    readNodeScrollback: async () => 'worker checkpoint',
  } as never
}

function registerSpawn(controlSurface: ReturnType<typeof createControlSurface>): void {
  controlSurface.register('pty.spawn', {
    kind: 'command',
    validate: payload => payload,
    handle: async () => ({
      sessionId: 'fresh-pty-session',
      profileId: null,
      runtimeKind: 'posix' as const,
    }),
    defaultErrorCode: 'terminal.spawn_failed',
  })
}

describe('terminal agent cold session recovery', () => {
  it('hydrates a fresh PTY and injects the exact durable resume command once', async () => {
    const controlSurface = createControlSurface()
    const write = vi.fn()
    registerSpawn(controlSurface)
    registerSessionPrepareOrReviveHandler(controlSurface, {
      ...createReadyTerminalAdmissionDeps(),
      getPersistenceStore: async () =>
        createStore({ resumeSessionId: 'resume-session-1', resumeSessionIdVerified: true }),
      ptyStreamHub: { isSessionActive: vi.fn(() => false) } as never,
      ptyRuntime: { write },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'workspace-1' },
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toMatchObject({
      nodes: [
        {
          nodeId: 'terminal-agent-1',
          recoveryState: 'restarted',
          sessionId: 'fresh-pty-session',
          isLiveSessionReattach: false,
        },
      ],
    })
    expect(write.mock.calls).toEqual([
      ['fresh-pty-session', '\u0003'],
      ['fresh-pty-session', '\u0015codex resume resume-session-1\r'],
    ])
  })

  it('hydrates an unverified legacy binding as a shell without launching a new agent', async () => {
    const controlSurface = createControlSurface()
    const write = vi.fn()
    registerSpawn(controlSurface)
    registerSessionPrepareOrReviveHandler(controlSurface, {
      ...createReadyTerminalAdmissionDeps(),
      getPersistenceStore: async () =>
        createStore({ resumeSessionId: null, resumeSessionIdVerified: false }),
      ptyStreamHub: { isSessionActive: vi.fn(() => false) } as never,
      ptyRuntime: { write },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'workspace-1' },
    })

    expect(result.ok).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })
})
