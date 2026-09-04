import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerTerminalAgentActivityHandlers } from '../../../src/app/main/controlSurface/handlers/terminalAgentActivityHandlers'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

const context: ControlSurfaceContext = {
  now: () => new Date('2026-09-01T00:00:00.000Z'),
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

function createHub(): PtyStreamHub {
  return new PtyStreamHub({
    replayWindowMaxBytes: 64_000,
    ptyRuntime: {
      spawnSession: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
    },
  })
}

function registerTerminal(hub: PtyStreamHub, sessionId: string): void {
  hub.registerSessionMetadata({
    sessionId,
    kind: 'terminal',
    startedAt: '2026-09-01T00:00:00.000Z',
    cwd: '/tmp',
    command: 'shell',
    args: [],
    cols: 80,
    rows: 24,
  })
}

function activityMetadata(sessionId: string, revision: number) {
  return {
    sessionId,
    resumeSessionId: 'provider-session-1',
    terminalAgentActivity: {
      provider: 'claude-code' as const,
      invocationId: 'invocation-1',
      generation: 1,
      phase: 'active' as const,
      observedAtMs: 1_000 + revision,
      identityAuthority: 'provider_session_start' as const,
      sourceRevision: revision,
      revision,
    },
  }
}

describe('terminal Agent activity baseline query', () => {
  it('lists the Hub latest validated metadata as defensive copies', () => {
    const hub = createHub()
    registerTerminal(hub, 'local-session')
    hub.registerSessionAgentMetadata(activityMetadata('local-session', 1))
    hub.registerSessionAgentMetadata(activityMetadata('local-session', 2))
    hub.registerSessionAgentMetadata(activityMetadata('local-session', 1))
    hub.registerSessionAgentMetadata({
      sessionId: 'local-session',
      resumeSessionId: 'stale-provider-session',
    })

    expect(hub.listTerminalAgentActivityMetadata()).toEqual({
      entries: [activityMetadata('local-session', 2)],
    })

    const first = hub.listTerminalAgentActivityMetadata()
    first.entries[0]!.terminalAgentActivity.phase = 'exited'
    expect(hub.listTerminalAgentActivityMetadata()).toEqual({
      entries: [activityMetadata('local-session', 2)],
    })
  })

  it('filters malformed cached activity and clears the baseline on terminal exit or forget', () => {
    const hub = createHub()
    registerTerminal(hub, 'invalid-session')
    hub.registerSessionAgentMetadata({
      sessionId: 'invalid-session',
      resumeSessionId: null,
      terminalAgentActivity: {
        ...activityMetadata('invalid-session', 1).terminalAgentActivity,
        generation: Number.NaN,
      },
    } as never)
    expect(hub.listTerminalAgentActivityMetadata()).toEqual({ entries: [] })

    registerTerminal(hub, 'exit-session')
    hub.registerSessionAgentMetadata(activityMetadata('exit-session', 1))
    hub.handlePtyExit('exit-session', 0)
    hub.registerSessionAgentMetadata(activityMetadata('exit-session', 2))
    hub.registerSessionAgentState({
      sessionId: 'exit-session',
      state: 'working',
      source: 'claude_hook',
      observedAtMs: 9_000,
    })
    expect(hub.listTerminalAgentActivityMetadata()).toEqual({ entries: [] })

    registerTerminal(hub, 'forgotten-session')
    hub.registerSessionAgentMetadata(activityMetadata('forgotten-session', 1))
    hub.forgetSession('forgotten-session')
    expect(hub.listTerminalAgentActivityMetadata()).toEqual({ entries: [] })
  })

  it('registers a payload-validated query and never a command', async () => {
    const listTerminalAgentActivityMetadata = vi.fn(() => ({
      entries: [activityMetadata('session-query', 3)],
    }))
    const controlSurface = createControlSurface()
    registerTerminalAgentActivityHandlers(controlSurface, {
      ptyStreamHub: { listTerminalAgentActivityMetadata } as never,
    })

    await expect(
      controlSurface.invoke(context, {
        kind: 'query',
        id: 'session.terminalAgentActivity.list',
        payload: null,
      }),
    ).resolves.toEqual({
      __opencoveControlEnvelope: true,
      ok: true,
      value: { entries: [activityMetadata('session-query', 3)] },
    })
    expect(listTerminalAgentActivityMetadata).toHaveBeenCalledTimes(1)

    const invalidPayload = await controlSurface.invoke(context, {
      kind: 'query',
      id: 'session.terminalAgentActivity.list',
      payload: {},
    })
    expect(invalidPayload).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })

    const command = await controlSurface.invoke(context, {
      kind: 'command',
      id: 'session.terminalAgentActivity.list',
      payload: null,
    })
    expect(command).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
    expect(listTerminalAgentActivityMetadata).toHaveBeenCalledTimes(1)
  })
})
