import { expect, it } from 'vitest'
import { ClaudeInvocationJournal } from '../../../src/contexts/agent/application/ClaudeInvocationJournal'
import type { ClaudeConversationEvent } from '../../../src/shared/runtime/agentHook/claudeConversation'
const fixture = () => {
  let now = 100000
  const journal = new ClaudeInvocationJournal(() => now)
  const hook = (id: string, name: string, at: number) =>
    journal.appendHook({
      claudeSessionId: id,
      hookEventName: name,
      emittedAtMs: 100000 + at,
      state:
        name === 'UserPromptSubmit'
          ? 'working'
          : name === 'PermissionRequest'
            ? 'waiting'
            : ['Stop', 'SessionEnd'].includes(name)
              ? 'done'
              : null,
      sessionStartSource: name === 'SessionStart' ? 'clear' : undefined,
      sessionEndReason: name === 'SessionEnd' ? 'clear' : undefined,
    } as ClaudeConversationEvent)
  hook('A', 'SessionStart', 1)
  return {
    journal,
    hook,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
  }
}
it.each(['working', 'waiting'] as const)(
  'quiet never retires a known successor %s capture',
  state => {
    const f = fixture(),
      capture = f.journal.capture('B')
    f.hook('A', 'SessionEnd', 19)
    f.hook('B', 'SessionStart', 20)
    f.advance(201)
    expect(f.journal.view().ready).toBe(true)
    f.journal.appendIO({
      sessionId: 's',
      providerSessionId: 'B',
      conversationCapture: capture,
      generation: 1,
      fileIdentity: 'B',
      position: 1,
      baseline: true,
      activity: { state, observedAt: f.now() },
    })
    expect(f.journal.view()).toMatchObject({ ready: false, unresolved: true })
    f.hook('B', 'Stop', 300)
    f.journal.complete('B', undefined, 100300)
    expect(f.journal.view().ready).toBe(true)
  },
)
it('explicit replacement retires old capabilities without retiring pending successor captures', () => {
  const f = fixture(),
    a = f.journal.capture('A'),
    b = f.journal.capture('B')
  f.hook('A', 'SessionEnd', 19)
  f.hook('B', 'SessionStart', 20)
  f.advance(10000)
  expect(f.journal.accepts('A', a)).toBe(false)
  expect(f.journal.accepts('B', b)).toBe(true)
  f.hook('C', 'SessionStart', 30)
  expect(f.journal.accepts('B', b)).toBe(false)
})
it('rejects capabilities from a replaced invocation and disposal', () => {
  const f = fixture(),
    a = f.journal.capture('A'),
    other = fixture()
  expect(other.journal.accepts('A', a)).toBe(false)
  f.journal.dispose()
  expect(f.journal.accepts('A', a)).toBe(false)
})
it('unknown captures veto current readiness and ordinary idle cannot resolve them', () => {
  const f = fixture(),
    capture = f.journal.capture()
  f.hook('B', 'SessionStart', 20)
  f.advance(201)
  expect(f.journal.accepts('A', capture)).toBe(false)
  expect(f.journal.accepts('B', capture)).toBe(true)
  f.journal.appendIO({
    sessionId: 's',
    providerSessionId: 'B',
    conversationCapture: capture,
    generation: 1,
    fileIdentity: 'B',
    position: 1,
    baseline: true,
    record: { kind: 'user', promptId: 'p', promptSource: 'unknown' },
  })
  f.journal.appendIO({
    sessionId: 's',
    providerSessionId: 'B',
    conversationCapture: capture,
    generation: 1,
    fileIdentity: 'B',
    position: 2,
    baseline: true,
    activity: { state: 'idle', observedAt: f.now() },
  })
  expect(f.journal.view().ready).toBe(false)
})
it('keeps lost evidence until a covering authenticated completion', () => {
  const f = fixture()
  f.hook('B', 'SessionStart', 20)
  for (let n = 0; n < 200; n++) {
    f.journal.unknown('B')
    f.advance(1)
  }
  f.hook('B', 'Stop', 50)
  f.journal.complete('B', undefined, 100050)
  expect(f.journal.view()).toMatchObject({ ready: false, blocked: true })
  f.hook('B', 'Stop', 500)
  f.journal.complete('B', undefined, 100500)
  f.advance(10000)
  expect(f.journal.events.length).toBeLessThanOrEqual(128)
  expect(f.journal.view()).toMatchObject({ ready: true, blocked: false })
})

it('withholds authority for tied distinct namespaces and recovers with explicit replacement', () => {
  const f = fixture()
  f.hook('B', 'SessionStart', 20)
  f.hook('B', 'SessionStart', 20)
  f.advance(201)
  expect(f.journal.view().ready).toBe(true)
  f.hook('C', 'SessionStart', 20)
  f.advance(10000)
  expect(f.journal.view()).toMatchObject({ ready: false, blocked: true })
  f.hook('D', 'SessionStart', 30)
  f.advance(201)
  expect(f.journal.view().ready).toBe(true)
})
