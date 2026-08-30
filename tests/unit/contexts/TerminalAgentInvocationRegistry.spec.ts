import { describe, expect, it } from 'vitest'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'

describe('TerminalAgentInvocationRegistry', () => {
  it('owns generations and publishes a revisioned bound-terminal baseline', () => {
    let now = 1_000
    const registry = new TerminalAgentInvocationRegistry({ now: () => now })
    const events: unknown[] = []
    registry.onMetadata(event => events.push(event))
    const terminal = registry.reserve({ sourceId: 'terminal-shim' })

    const first = terminal.beginInvocation({
      invocationId: 'invocation-1',
      provider: 'claude-code',
    })
    expect(first?.generation).toBe(1)
    expect(registry.list()).toEqual({ revision: 0, entries: [] })

    terminal.bind('pty-1')

    expect(events).toEqual([
      {
        sessionId: 'pty-1',
        resumeSessionId: null,
        agentProvider: 'claude-code',
        terminalAgentActivity: {
          provider: 'claude-code',
          invocationId: 'invocation-1',
          generation: 1,
          phase: 'active',
          observedAtMs: 1_000,
          identityAuthority: null,
          sourceRevision: 1,
          revision: 1,
        },
      },
    ])
    expect(registry.list()).toEqual({ revision: 1, entries: events })

    now = 1_100
    const secondTerminal = registry.reserve({ sourceId: 'terminal-shim' })
    const second = secondTerminal.beginInvocation({
      invocationId: 'invocation-other-terminal',
      provider: 'codex',
    })
    secondTerminal.bind('pty-2')

    expect(second?.generation).toBe(1)
    expect(events[1]).toMatchObject({
      terminalAgentActivity: { sourceRevision: 2, revision: 2 },
    })

    const independentSource = registry.reserve({ sourceId: 'independent-source' })
    independentSource.bind('pty-3')
    independentSource.beginInvocation({ invocationId: 'invocation-3', provider: 'codex' })
    expect(events[2]).toMatchObject({
      terminalAgentActivity: { sourceRevision: 1, revision: 3 },
    })
    expect(registry.list()).toMatchObject({
      revision: 3,
      entries: [events[0], events[1], events[2]],
    })
  })

  it('keeps one verified identity in active and exited live baselines', () => {
    let now = 2_000
    const registry = new TerminalAgentInvocationRegistry({ now: () => now })
    const events: unknown[] = []
    registry.onMetadata(event => events.push(event))
    const terminal = registry.reserve({ sourceId: 'terminal-shim' })
    terminal.bind('pty-1')
    const invocation = terminal.beginInvocation({
      invocationId: 'invocation-1',
      provider: 'claude-code',
    })

    now = 2_100
    expect(
      invocation?.observe({
        identityAuthority: 'provider_session_start',
        resumeSessionId: 'provider-session-1',
      }),
    ).toBe(true)
    expect(registry.list()).toMatchObject({
      revision: 2,
      entries: [
        {
          sessionId: 'pty-1',
          resumeSessionId: 'provider-session-1',
          terminalAgentActivity: {
            phase: 'active',
            identityAuthority: 'provider_session_start',
          },
        },
      ],
    })

    expect(
      invocation?.observe({
        identityAuthority: 'provider_session_start',
        resumeSessionId: 'provider-session-1',
      }),
    ).toBe(true)
    expect(
      invocation?.observe({
        identityAuthority: 'provider_session_start',
        resumeSessionId: 'conflicting-provider-session',
      }),
    ).toBe(false)
    expect(registry.list().revision).toBe(2)

    now = 2_200
    expect(terminal.complete({ invocationId: 'invocation-1', generation: 1 })).toBe(true)
    expect(invocation?.isCurrent()).toBe(false)

    now = 2_300
    expect(
      invocation?.observe({
        identityAuthority: 'provider_session_start',
        resumeSessionId: 'late-provider-session',
      }),
    ).toBe(false)
    expect(terminal.complete({ invocationId: 'invocation-1', generation: 1 })).toBe(false)
    expect(events).toHaveLength(3)
    expect(events[1]).toMatchObject({
      resumeSessionId: 'provider-session-1',
      terminalAgentActivity: {
        phase: 'active',
        sourceRevision: 2,
        revision: 2,
        identityAuthority: 'provider_session_start',
      },
    })
    expect(events[2]).toMatchObject({
      resumeSessionId: 'provider-session-1',
      terminalAgentActivity: {
        phase: 'exited',
        sourceRevision: 3,
        revision: 3,
        identityAuthority: 'provider_session_start',
      },
    })
    expect(registry.list()).toMatchObject({
      revision: 3,
      entries: [
        {
          sessionId: 'pty-1',
          resumeSessionId: 'provider-session-1',
          terminalAgentActivity: {
            phase: 'exited',
            revision: 3,
            identityAuthority: 'provider_session_start',
          },
        },
      ],
    })
  })

  it('accepts only the provider identity explicitly targeted by a resume invocation', () => {
    const registry = new TerminalAgentInvocationRegistry()
    const terminal = registry.reserve({ sourceId: 'terminal-shim' })
    terminal.bind('pty-1')
    const invocation = terminal.beginInvocation({
      invocationId: 'invocation-resume',
      provider: 'codex',
      expectedResumeSessionId: 'provider-session-target',
    })

    expect(
      invocation?.observe({
        identityAuthority: 'provider_session_start',
        resumeSessionId: 'provider-session-unexpected',
      }),
    ).toBe(false)
    expect(registry.list().entries[0]).toMatchObject({
      resumeSessionId: null,
      terminalAgentActivity: { identityAuthority: null },
    })
    expect(
      invocation?.observe({
        identityAuthority: 'provider_session_start',
        resumeSessionId: 'provider-session-target',
      }),
    ).toBe(true)
    expect(registry.list().entries[0]).toMatchObject({
      resumeSessionId: 'provider-session-target',
      terminalAgentActivity: { identityAuthority: 'provider_session_start' },
    })
  })

  it('bounds still-live superseded invocations without replacing the current invocation', () => {
    const registry = new TerminalAgentInvocationRegistry({
      maxPendingLiveInvocationsPerTerminal: 1,
    })
    const terminal = registry.reserve({ sourceId: 'terminal-shim' })
    terminal.bind('pty-1')

    const first = terminal.beginInvocation({ invocationId: 'invocation-1', provider: 'codex' })
    const second = terminal.beginInvocation({ invocationId: 'invocation-2', provider: 'codex' })

    expect(first?.isCurrent()).toBe(false)
    expect(second?.isCurrent()).toBe(true)
    expect(
      terminal.beginInvocation({ invocationId: 'invocation-rejected', provider: 'codex' }),
    ).toBeNull()
    expect(second?.isCurrent()).toBe(true)
    expect(terminal.complete({ invocationId: 'invocation-1', generation: 1 })).toBe(true)
    expect(
      terminal.beginInvocation({ invocationId: 'invocation-3', provider: 'codex' })?.generation,
    ).toBe(3)
  })

  it('retains only bounded completed tombstones while preserving live superseded work', () => {
    const registry = new TerminalAgentInvocationRegistry({
      maxTombstonesPerTerminal: 2,
    })
    const terminal = registry.reserve({ sourceId: 'terminal-shim' })
    terminal.bind('pty-1')

    for (let generation = 1; generation <= 4; generation += 1) {
      const invocationId = `invocation-${generation}`
      expect(terminal.beginInvocation({ invocationId, provider: 'codex' })?.generation).toBe(
        generation,
      )
      expect(terminal.complete({ invocationId, generation })).toBe(true)
    }

    expect(terminal.beginInvocation({ invocationId: 'invocation-3', provider: 'codex' })).toBeNull()
    expect(
      terminal.beginInvocation({ invocationId: 'invocation-1', provider: 'codex' })?.generation,
    ).toBe(5)
  })

  it('releases terminal state without ending PTY or provider binding semantics', () => {
    const registry = new TerminalAgentInvocationRegistry()
    const events: unknown[] = []
    registry.onMetadata(event => events.push(event))
    const terminal = registry.reserve({ sourceId: 'terminal-shim' })
    terminal.bind('pty-1')
    const invocation = terminal.beginInvocation({
      invocationId: 'invocation-1',
      provider: 'claude-code',
    })
    const beforeRelease = registry.list()

    terminal.release()

    expect(registry.list()).toEqual({ revision: beforeRelease.revision + 1, entries: [] })
    expect(invocation?.isCurrent()).toBe(false)
    expect(terminal.complete({ invocationId: 'invocation-1', generation: 1 })).toBe(false)
    expect(terminal.beginInvocation({ invocationId: 'invocation-2', provider: 'codex' })).toBeNull()
    expect(events).toHaveLength(1)
  })
})
