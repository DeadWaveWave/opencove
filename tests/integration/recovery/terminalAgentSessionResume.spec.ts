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
  provider: 'claude-code' | 'codex'
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
              terminalProviderHint: binding.provider,
              status: null,
              startedAt: null,
              endedAt: null,
              exitCode: null,
              lastError: null,
              scrollback: 'durable terminal history',
              executionDirectory: '/tmp/workspace',
              expectedDirectory: '/tmp/workspace',
              agent: binding,
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
  it.each([
    ['claude-code', 'claude --resume resume-session-1'],
    ['codex', 'codex resume resume-session-1'],
  ] as const)(
    'hydrates a fresh PTY and injects the exact durable %s resume command once',
    async (provider, resumeCommand) => {
      const controlSurface = createControlSurface()
      const write = vi.fn()
      let markShellReady: (() => void) | null = null
      const waitForShellReady = vi.fn(
        async () =>
          await new Promise<void>(resolve => {
            markShellReady = resolve
          }),
      )
      registerSpawn(controlSurface)
      registerSessionPrepareOrReviveHandler(controlSurface, {
        ...createReadyTerminalAdmissionDeps(),
        getPersistenceStore: async () =>
          createStore({
            provider,
            resumeSessionId: 'resume-session-1',
            resumeSessionIdVerified: true,
          }),
        ptyStreamHub: { isSessionActive: vi.fn(() => false) } as never,
        ptyRuntime: { write, waitForShellReady },
      })

      const resultPromise = controlSurface.invoke(ctx, {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId: 'workspace-1' },
      })

      await vi.waitFor(() => {
        expect(waitForShellReady).toHaveBeenCalledTimes(1)
      })
      expect(waitForShellReady).toHaveBeenCalledWith('fresh-pty-session')
      expect(write).not.toHaveBeenCalled()
      markShellReady?.()
      const result = await resultPromise

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
      expect(write.mock.calls).toEqual([['fresh-pty-session', `\u0015${resumeCommand}\r`]])
    },
  )

  it('does not relaunch an unverified provider hint after cold recovery', async () => {
    const controlSurface = createControlSurface()
    const write = vi.fn()
    let markShellReady: (() => void) | null = null
    const waitForShellReady = vi.fn(
      async () =>
        await new Promise<void>(resolve => {
          markShellReady = resolve
        }),
    )
    registerSpawn(controlSurface)
    registerSessionPrepareOrReviveHandler(controlSurface, {
      ...createReadyTerminalAdmissionDeps(),
      getPersistenceStore: async () =>
        createStore({
          provider: 'codex',
          resumeSessionId: null,
          resumeSessionIdVerified: false,
        }),
      ptyStreamHub: { isSessionActive: vi.fn(() => false) } as never,
      ptyRuntime: { write, waitForShellReady },
    })

    const resultPromise = controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'workspace-1' },
    })

    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(waitForShellReady).not.toHaveBeenCalled()
    expect(markShellReady).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })
})
