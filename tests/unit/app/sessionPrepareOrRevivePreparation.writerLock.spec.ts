import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type {
  NormalizedPersistedNode,
  NormalizedPersistedWorkspace,
} from '../../../src/platform/persistence/sqlite/normalize'

const { waitForWriterLockMock } = vi.hoisted(() => ({
  waitForWriterLockMock: vi.fn(async () => 'available' as const),
}))

vi.mock(
  '../../../src/app/main/controlSurface/handlers/codexResumeRecovery',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('../../../src/app/main/controlSurface/handlers/codexResumeRecovery')
    >()),
    waitForCodexWriterLockRelease: waitForWriterLockMock,
  }),
)

import { prepareAgentNode } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrRevivePreparation'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-08-15T00:00:00.000Z'),
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

const node: NormalizedPersistedNode = {
  id: 'agent-1',
  sessionId: 'stale-session',
  title: 'codex',
  position: { x: 0, y: 0 },
  width: 520,
  height: 360,
  kind: 'agent',
  profileId: null,
  runtimeKind: 'posix',
  terminalGeometry: { cols: 80, rows: 24 },
  terminalProviderHint: null,
  labelColorOverride: null,
  sidebarSortOrder: null,
  status: 'running',
  startedAt: '2026-08-14T00:00:00.000Z',
  endedAt: null,
  exitCode: null,
  lastError: null,
  executionDirectory: '/repo',
  expectedDirectory: '/repo',
  agent: null,
  task: null,
  scrollback: null,
}

const workspace: NormalizedPersistedWorkspace = {
  id: 'workspace-1',
  name: 'repo',
  iconId: null,
  path: '/repo',
  worktreesRoot: '',
  pullRequestBaseBranchOptions: [],
  environmentVariables: {},
  spaceArchiveRecords: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  isMinimapVisible: true,
  spaces: [],
  activeSpaceId: null,
  nodes: [],
}

const agent = {
  provider: 'codex' as const,
  prompt: '',
  model: null,
  effectiveModel: null,
  launchMode: 'resume' as const,
  resumeSessionId: 'thread-1',
  resumeSessionIdVerified: true,
  executionDirectory: '/repo',
  expectedDirectory: '/repo',
  directoryMode: 'workspace' as const,
  customDirectory: null,
  shouldCreateDirectory: false,
  taskId: null,
}

function successfulLaunch() {
  return {
    sessionId: 'resumed-session',
    provider: 'codex' as const,
    startedAt: '2026-08-15T00:00:00.000Z',
    executionContext: { workingDirectory: '/repo' },
    profileId: null,
    runtimeKind: 'posix' as const,
    resumeSessionId: 'thread-1',
    effectiveModel: null,
    command: 'codex',
    args: ['resume', 'thread-1'],
  }
}

async function prepare(controlSurface: ControlSurface) {
  return await prepareAgentNode({
    controlSurface,
    ctx,
    store: {} as never,
    workspace,
    node,
    space: null,
    agent,
    settings: DEFAULT_AGENT_SETTINGS,
  })
}

describe('session prepare/revive codex writer lock recovery', () => {
  beforeEach(() => {
    waitForWriterLockMock.mockClear()
  })

  it('waits before launch and succeeds after bounded active-writer retries', async () => {
    const order: string[] = []
    waitForWriterLockMock.mockImplementationOnce(async () => {
      order.push('wait')
      return 'available'
    })
    let launchCount = 0
    const controlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        expect(request.id).toBe('session.launchAgent')
        order.push('launch')
        launchCount += 1
        if (launchCount < 3) {
          return {
            ok: false,
            error: {
              code: 'agent.launch_failed',
              debugMessage: 'thread already has an active writer (code -32600)',
            },
          }
        }
        return { ok: true, value: successfulLaunch() }
      }),
    } as ControlSurface

    const prepared = await prepare(controlSurface)

    expect(order[0]).toBe('wait')
    expect(launchCount).toBe(3)
    expect(prepared.recoveryState).toBe('revived')
    expect(prepared.agent?.resumeSessionId).toBe('thread-1')
    expect(prepared.agent?.resumeSessionIdVerified).toBe(true)
  })

  it('keeps agent identity and retry capability when the writer conflict reaches its limit', async () => {
    let launchCount = 0
    const controlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        if (request.id === 'session.launchAgent') {
          launchCount += 1
          return {
            ok: false,
            error: {
              code: 'agent.launch_failed',
              debugMessage: 'thread already has an active writer (-32600)',
            },
          }
        }
        expect(request.id).toBe('pty.spawn')
        return {
          ok: true,
          value: { sessionId: 'fallback-shell', profileId: null, runtimeKind: 'posix' },
        }
      }),
    } as ControlSurface

    const prepared = await prepare(controlSurface)

    expect(launchCount).toBe(3)
    expect(prepared.kind).toBe('agent')
    expect(prepared.status).toBe('standby')
    expect(prepared.recoveryIssue).toBe('codex_writer_locked')
    expect(prepared.lastError).toBeNull()
    expect(prepared.agent?.resumeSessionId).toBe('thread-1')
    expect(prepared.agent?.resumeSessionIdVerified).toBe(true)
  })

  it('does not retry or soften a non-writer launch failure', async () => {
    let launchCount = 0
    const controlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        if (request.id === 'session.launchAgent') {
          launchCount += 1
          return {
            ok: false,
            error: { code: 'agent.launch_failed', debugMessage: 'executable missing' },
          }
        }
        return {
          ok: true,
          value: { sessionId: 'fallback-shell', profileId: null, runtimeKind: 'posix' },
        }
      }),
    } as ControlSurface

    const prepared = await prepare(controlSurface)

    expect(launchCount).toBe(1)
    expect(prepared.status).toBe('failed')
    expect(prepared.recoveryIssue).toBeNull()
    expect(prepared.lastError).toContain('executable missing')
  })
})
