import { describe, expect, it, vi } from 'vitest'
import {
  prepareTerminalNode,
  resolveNodeInitialPtyGeometry,
  resolvePrepareOrReviveResumeLocateTimeoutMs,
} from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrRevivePreparation'
import { toPreparedNodeResult } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveShared'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { NormalizedPersistedNode } from '../../../src/platform/persistence/sqlite/normalize'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-05-01T00:00:00.000Z'),
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

function createNode(overrides: Partial<NormalizedPersistedNode>): NormalizedPersistedNode {
  return {
    id: 'node-1',
    sessionId: null,
    title: 'agent',
    position: { x: 0, y: 0 },
    width: 520,
    height: 720,
    kind: 'agent',
    profileId: null,
    runtimeKind: null,
    terminalGeometry: null,
    terminalProviderHint: null,
    labelColorOverride: null,
    status: 'running',
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    executionDirectory: '/tmp/workspace',
    expectedDirectory: '/tmp/workspace',
    agent: null,
    task: null,
    scrollback: null,
    ...overrides,
  }
}

describe('session prepare/revive terminal geometry', () => {
  it('uses durable terminal geometry when it still fits the node frame', () => {
    const geometry = resolveNodeInitialPtyGeometry(
      createNode({ terminalGeometry: { cols: 64, rows: 44 }, width: 900, height: 900 }),
      { terminalFontSize: 13 } as never,
    )

    expect(geometry).toEqual({ cols: 64, rows: 44 })
  })

  it('does not shrink durable terminal geometry during restore', () => {
    const geometry = resolveNodeInitialPtyGeometry(
      createNode({ terminalGeometry: { cols: 80, rows: 44 }, width: 520, height: 720 }),
      { terminalFontSize: 13 } as never,
    )

    expect(geometry).toEqual({ cols: 80, rows: 44 })
  })

  it('preserves restored OpenCode durable geometry without provider widening', () => {
    const geometry = resolveNodeInitialPtyGeometry(
      createNode({ terminalGeometry: { cols: 64, rows: 44 }, width: 520, height: 720 }),
      { terminalFontSize: 13 } as never,
      'opencode',
    )

    expect(geometry).toEqual({ cols: 64, rows: 44 })
  })

  it('falls back to a bounded frame estimate when no durable geometry exists', () => {
    const geometry = resolveNodeInitialPtyGeometry(
      createNode({ terminalGeometry: null, width: 520, height: 720 }),
      { terminalFontSize: 13 } as never,
    )

    expect(geometry.cols).toBeGreaterThan(40)
    expect(geometry.rows).toBeGreaterThan(10)
  })

  it('returns worker-prepared geometry instead of stale null persisted geometry', () => {
    const result = toPreparedNodeResult(createNode({ terminalGeometry: null }), {
      recoveryState: 'revived',
      sessionId: 'revived-session',
      isLiveSessionReattach: false,
      profileId: null,
      runtimeKind: 'posix',
      status: 'standby',
      startedAt: '2026-04-30T00:00:00.000Z',
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      terminalGeometry: { cols: 72, rows: 42 },
      executionDirectory: '/tmp/workspace',
      expectedDirectory: '/tmp/workspace',
      agent: null,
    })

    expect(result.terminalGeometry).toEqual({ cols: 72, rows: 42 })
  })

  it('keeps missing durable geometry as null when restarting a terminal node', async () => {
    const controlSurface: ControlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        expect(request.id).toBe('pty.spawn')
        expect(request.payload).toMatchObject({
          cwd: '/tmp/workspace',
          cols: 80,
          rows: 24,
        })
        return {
          ok: true,
          value: {
            sessionId: 'restarted-terminal-session',
            profileId: null,
            runtimeKind: 'posix' as const,
          },
        }
      }),
    } as ControlSurface

    const prepared = await prepareTerminalNode({
      controlSurface,
      ctx,
      store: {
        readNodeScrollback: vi.fn(async () => null),
      } as never,
      workspace: {
        id: 'workspace-1',
        name: 'repo',
        path: '/tmp/workspace',
        worktreesRoot: '',
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [],
        activeSpaceId: null,
        nodes: [],
      },
      node: createNode({
        kind: 'terminal',
        title: 'terminal',
        profileId: null,
        runtimeKind: 'posix',
        terminalGeometry: null,
      }),
      space: null,
    })

    expect(prepared.sessionId).toBe('restarted-terminal-session')
    expect(prepared.terminalGeometry).toBeNull()
  })
})

describe('session prepare/revive resume discovery timeout', () => {
  it('uses a short polling window only for very recent agent launches', () => {
    const nowMs = Date.parse('2026-04-29T12:00:00.000Z')

    expect(resolvePrepareOrReviveResumeLocateTimeoutMs(nowMs - 5_000, nowMs)).toBeGreaterThan(0)
    expect(resolvePrepareOrReviveResumeLocateTimeoutMs(nowMs - 5 * 60_000, nowMs)).toBe(0)
    expect(resolvePrepareOrReviveResumeLocateTimeoutMs(Number.NaN, nowMs)).toBe(0)
  })
})
