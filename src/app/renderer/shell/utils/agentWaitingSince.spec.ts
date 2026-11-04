import { describe, expect, it } from 'vitest'
import { advanceWaitingSince, type ObservedAgentStatus } from './agentWaitingSince'

function observe(entries: Array<[string, ObservedAgentStatus]>) {
  return entries.map(([nodeId, status]) => ({ nodeId, status }))
}

describe('advanceWaitingSince', () => {
  it('stamps an agent when it starts waiting after being seen at work', () => {
    const first = advanceWaitingSince(new Map(), observe([['a', 'running']]), 1_000)
    const second = advanceWaitingSince(first, observe([['a', 'waiting']]), 5_000)
    expect(second.get('a')).toEqual({ status: 'waiting', waitingSinceMs: 5_000 })
  })

  it('keeps the first stamp while the agent keeps waiting', () => {
    let state = advanceWaitingSince(new Map(), observe([['a', 'standby']]), 1_000)
    state = advanceWaitingSince(state, observe([['a', 'waiting']]), 2_000)
    state = advanceWaitingSince(state, observe([['a', 'waiting']]), 9_000)
    expect(state.get('a')?.waitingSinceMs).toBe(2_000)
  })

  it('does not guess for agents already waiting when first seen or after restoring', () => {
    let state = advanceWaitingSince(
      new Map(),
      observe([
        ['restored', 'waiting'],
        ['b', 'restoring'],
      ]),
      1_000,
    )
    state = advanceWaitingSince(
      state,
      observe([
        ['restored', 'waiting'],
        ['b', 'waiting'],
      ]),
      2_000,
    )
    expect(state.get('restored')?.waitingSinceMs).toBeNull()
    expect(state.get('b')?.waitingSinceMs).toBeNull()
  })

  it('clears the stamp when the agent moves on and forgets closed agents', () => {
    let state = advanceWaitingSince(
      new Map(),
      observe([
        ['a', 'running'],
        ['b', 'running'],
      ]),
      1_000,
    )
    state = advanceWaitingSince(
      state,
      observe([
        ['a', 'waiting'],
        ['b', 'waiting'],
      ]),
      2_000,
    )
    state = advanceWaitingSince(state, observe([['a', 'running']]), 3_000)
    expect(state.get('a')).toEqual({ status: 'running', waitingSinceMs: null })
    expect(state.has('b')).toBe(false)
  })

  it('returns the same map when nothing changed', () => {
    const state = advanceWaitingSince(new Map(), observe([['a', 'running']]), 1_000)
    expect(advanceWaitingSince(state, observe([['a', 'running']]), 2_000)).toBe(state)
  })
})
