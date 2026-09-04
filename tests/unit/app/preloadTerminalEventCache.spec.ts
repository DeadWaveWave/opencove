import { describe, expect, it, vi } from 'vitest'
import { TerminalEventReplayCache } from '../../../src/app/preload/terminalEventReplayCache'

function state(sessionId: string, source: 'session_file' | 'claude_hook', observedAtMs: number) {
  return {
    sessionId,
    state: source === 'claude_hook' ? ('working' as const) : ('waiting' as const),
    source,
    observedAtMs,
  }
}

function metadata(sessionId: string) {
  return { sessionId, resumeSessionId: null }
}

describe('preload terminal event replay cache', () => {
  it('replays one original observation per session and source without renewing freshness', () => {
    const cache = new TerminalEventReplayCache({ maxSessions: 4 })
    cache.registerState(state('session-1', 'claude_hook', 1_000))
    cache.registerState(state('session-1', 'session_file', 2_000))

    const replayed = vi.fn()
    cache.replayStates(replayed)
    expect(replayed.mock.calls.map(([event]) => event)).toEqual([
      state('session-1', 'claude_hook', 1_000),
      state('session-1', 'session_file', 2_000),
    ])

    cache.replayStates(replayed)
    expect(replayed.mock.calls.slice(2).map(([event]) => event.observedAtMs)).toEqual([
      1_000, 2_000,
    ])
  })

  it('replaces only the matching source and bounds whole terminal sessions', () => {
    const cache = new TerminalEventReplayCache({ maxSessions: 2 })
    cache.registerState(state('session-1', 'claude_hook', 1_000))
    cache.registerState(state('session-1', 'session_file', 2_000))
    cache.registerMetadata(metadata('session-1'))
    cache.registerState(state('session-1', 'claude_hook', 3_000))
    cache.registerState(state('session-2', 'session_file', 4_000))
    cache.registerState(state('session-3', 'session_file', 5_000))

    const states: unknown[] = []
    const metadataEvents: unknown[] = []
    cache.replayStates(event => states.push(event))
    cache.replayMetadata(event => metadataEvents.push(event))

    expect(states).toEqual([
      state('session-2', 'session_file', 4_000),
      state('session-3', 'session_file', 5_000),
    ])
    expect(metadataEvents).toEqual([])
  })

  it('clears state and metadata together on terminal exit', () => {
    const cache = new TerminalEventReplayCache({ maxSessions: 2 })
    cache.registerState(state('session-1', 'claude_hook', 1_000))
    cache.registerMetadata(metadata('session-1'))
    cache.disposeSession('session-1')

    const stateListener = vi.fn()
    const metadataListener = vi.fn()
    cache.replayStates(stateListener)
    cache.replayMetadata(metadataListener)
    expect(stateListener).not.toHaveBeenCalled()
    expect(metadataListener).not.toHaveBeenCalled()
  })
})
