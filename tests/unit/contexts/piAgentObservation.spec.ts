import { describe, expect, it } from 'vitest'
import { PiAgentObservationOwner } from '../../../src/contexts/agent/domain/PiAgentObservationOwner'
import { normalizePiAgentSnapshot } from '../../../src/shared/runtime/piAgentSnapshot'

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    pid: 123,
    sequence: 1,
    conversationRevision: 1,
    sessionId: 'conversation-a',
    sessionFile: '/custom/sessions/a.jsonl',
    persistence: 'allocated',
    state: 'standby',
    ...overrides,
  }
}

function accept(owner: PiAgentObservationOwner, overrides: Record<string, unknown> = {}) {
  const value = normalizePiAgentSnapshot(snapshot(overrides))
  expect(value).not.toBeNull()
  return owner.accept(value!)
}

describe('Pi snapshot boundary', () => {
  it('accepts complete versioned snapshots, including ephemeral sessions', () => {
    expect(normalizePiAgentSnapshot(snapshot())).toEqual(snapshot())
    expect(
      normalizePiAgentSnapshot(snapshot({ sessionFile: null, persistence: 'ephemeral' })),
    ).toMatchObject({ persistence: 'ephemeral' })
  })

  it.each([
    { version: 2 },
    { pid: 0 },
    { pid: 1.5 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { sequence: 0 },
    { conversationRevision: 0 },
    { conversationRevision: 2 },
    { sessionId: '' },
    { sessionId: ' a ' },
    { sessionFile: 'relative.jsonl' },
    { sessionFile: '/tmp/a\u0000.jsonl' },
    { state: 'done' },
    { persistence: 'unknown' },
    { sessionFile: null },
    { persistence: 'ephemeral' },
    { persistence: 'resumable', sessionFile: null },
  ])('rejects malformed or contradictory snapshot %j', overrides => {
    expect(normalizePiAgentSnapshot(snapshot(overrides))).toBeNull()
  })

  it('accepts native Windows absolute session paths without depending on host OS', () => {
    expect(
      normalizePiAgentSnapshot(snapshot({ sessionFile: 'C:\\sessions\\a.jsonl' })),
    ).not.toBeNull()
  })
})

describe('PiAgentObservationOwner', () => {
  it('does not equate an allocated identity with a resumable transcript', () => {
    const owner = new PiAgentObservationOwner()
    expect(accept(owner)).toMatchObject({ identity: null, state: 'standby' })
    expect(
      accept(owner, { sequence: 2, persistence: 'resumable', state: 'working' }),
    ).toMatchObject({ identity: { resumeSessionId: '/custom/sessions/a.jsonl' }, state: 'working' })
    expect(accept(owner, { sequence: 3 })).toMatchObject({ identity: null })
  })

  it('rejects stale, duplicate, foreign-process and retired observations without advancing state', () => {
    const owner = new PiAgentObservationOwner()
    accept(owner, { sequence: 4 })
    expect(accept(owner, { sequence: 3, state: 'working' })).toBeNull()
    expect(accept(owner, { sequence: 4 })).toBeNull()
    expect(accept(owner, { sequence: 100, pid: 456 })).toBeNull()
    expect(accept(owner, { sequence: 5 })).not.toBeNull()
    owner.dispose()
    expect(accept(owner, { sequence: 6 })).toBeNull()
  })

  it('keeps reload ordering and permits explicit new/resume/fork without a new invocation', () => {
    const owner = new PiAgentObservationOwner()
    accept(owner, { persistence: 'resumable' })
    expect(accept(owner, { sequence: 2, persistence: 'resumable' })).toMatchObject({
      identity: null,
    })
    expect(
      accept(owner, {
        sequence: 3,
        conversationRevision: 2,
        sessionId: 'conversation-b',
        sessionFile: '/custom/b.jsonl',
      }),
    ).toMatchObject({ identity: { resumeSessionId: null } })
    expect(
      accept(owner, {
        sequence: 4,
        conversationRevision: 2,
        sessionId: 'conversation-b',
        sessionFile: '/custom/b.jsonl',
        persistence: 'resumable',
      }),
    ).toMatchObject({ identity: { resumeSessionId: '/custom/b.jsonl' } })
    expect(
      accept(owner, { sequence: 5, conversationRevision: 3, persistence: 'resumable' }),
    ).toMatchObject({ identity: { resumeSessionId: '/custom/sessions/a.jsonl' } })
    expect(accept(owner, { sequence: 6, conversationRevision: 2 })).toBeNull()
  })

  it('rejects identity changes without an explicit conversation revision', () => {
    const owner = new PiAgentObservationOwner()
    accept(owner)
    expect(accept(owner, { sequence: 2, sessionId: 'other' })).toBeNull()
    expect(accept(owner, { sequence: 3, sessionFile: '/other.jsonl' })).toBeNull()
  })

  it('carries a missed conversation transition in a coalesced full snapshot', () => {
    const owner = new PiAgentObservationOwner()
    accept(owner, { persistence: 'resumable' })
    expect(
      accept(owner, {
        sequence: 12,
        conversationRevision: 4,
        sessionId: 'new',
        sessionFile: '/new.jsonl',
      }),
    ).toMatchObject({ identity: { resumeSessionId: null } })
  })

  it('explicit ephemeral sessions clear binding, unlike a missing transcript', () => {
    const owner = new PiAgentObservationOwner()
    expect(accept(owner, { sessionFile: null, persistence: 'ephemeral' })).toMatchObject({
      identity: { resumeSessionId: null },
    })
    expect(
      accept(owner, { sequence: 2, sessionFile: null, persistence: 'ephemeral' }),
    ).toMatchObject({ identity: null })
  })
})
