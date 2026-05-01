import { describe, expect, it } from 'vitest'
import {
  resolveNodeInitialPtyGeometry,
  resolvePrepareOrReviveResumeLocateTimeoutMs,
} from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrRevivePreparation'
import { toPreparedNodeResult } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveShared'
import type { NormalizedPersistedNode } from '../../../src/platform/persistence/sqlite/normalize'

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
  it('uses durable terminal geometry before estimating from the node frame', () => {
    const geometry = resolveNodeInitialPtyGeometry(
      createNode({ terminalGeometry: { cols: 64, rows: 44 }, width: 900, height: 900 }),
      { terminalFontSize: 13 } as never,
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
})

describe('session prepare/revive resume discovery timeout', () => {
  it('uses a short polling window only for very recent agent launches', () => {
    const nowMs = Date.parse('2026-04-29T12:00:00.000Z')

    expect(resolvePrepareOrReviveResumeLocateTimeoutMs(nowMs - 5_000, nowMs)).toBeGreaterThan(0)
    expect(resolvePrepareOrReviveResumeLocateTimeoutMs(nowMs - 5 * 60_000, nowMs)).toBe(0)
    expect(resolvePrepareOrReviveResumeLocateTimeoutMs(Number.NaN, nowMs)).toBe(0)
  })
})
