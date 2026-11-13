import { expect, it } from 'vitest'
import { ClaudeInvocationJournal } from '../../../src/contexts/agent/application/ClaudeInvocationJournal'
const fixture = () => {
  let now = 100000
  const journal = new ClaudeInvocationJournal(() => now)
  const hook = (id: string, name: string, at: number, promptId?: string) =>
    journal.appendHook({
      claudeSessionId: id,
      hookEventName: name,
      emittedAtMs: 100000 + at,
      promptId,
      sessionStartSource: name === 'SessionStart' ? 'clear' : undefined,
      state: name === 'UserPromptSubmit' ? 'working' : name === 'Stop' ? 'done' : null,
    })
  hook('B', 'SessionStart', 10)
  now += 201
  const activity = (id: string, n: number, promptId?: string) =>
    journal.appendIO({
      sessionId: 's',
      providerSessionId: id,
      conversationCapture: journal.capture(id),
      generation: 1,
      fileIdentity: id,
      position: n,
      baseline: true,
      ...(promptId
        ? { record: { kind: 'user' as const, promptId, promptSource: 'typed' } }
        : { activity: { state: 'waiting' as const, observedAt: 100000 + n } }),
    })
  return { journal, hook, activity }
}
it('retains unbound U activity across more than twice the fact bound in completions', () => {
  const f = fixture()
  f.activity('U', 20)
  for (let n = 0; n < 256; n++) {
    f.hook('B', 'Stop', 30 + n)
    f.journal.complete('B', undefined, 100030 + n)
  }
  expect(f.journal.view()).toMatchObject({ ready: false, blocked: true, unresolved: true })
  expect(f.journal.events.some(e => e.id === 'U')).toBe(true)
  expect(f.journal.events.length).toBeLessThanOrEqual(128)
})
it('keeps a lost unknown-source veto even after a current completion and replacement', () => {
  const f = fixture()
  for (let n = 0; n < 256; n++) {
    f.activity(`U${n}`, 20 + n)
  }
  f.hook('B', 'Stop', 500)
  f.journal.complete('B', undefined, 100500)
  f.hook('C', 'SessionStart', 600)
  f.hook('C', 'Stop', 700)
  f.journal.complete('C', undefined, 100700)
  expect(f.journal.view()).toMatchObject({ ready: false, blocked: true })
  f.journal.dispose()
  expect(f.journal.view().ready).toBe(false)
})
it.each([undefined, 'p'])(
  'lets a later current completion cover lost activity, prompt=%s',
  prompt => {
    const f = fixture()
    for (let n = 0; n < 256; n++) {
      f.activity('B', 20 + n, prompt)
    }
    expect(f.journal.view()).toMatchObject({ ready: false, blocked: true })
    f.hook('B', 'Stop', 500, prompt)
    f.journal.complete('B', prompt, 100500)
    expect(f.journal.view()).toMatchObject({ ready: true, blocked: false, unresolved: false })
  },
)
it('does not infer completion or overflow from a flood of captures without activity', () => {
  const f = fixture(),
    first = f.journal.capture('U0')
  for (let n = 1; n < 256; n++) {
    f.journal.capture(`U${n}`)
  }
  expect(f.journal.view().ready).toBe(true)
  expect(f.journal.accepts('U0', first)).toBe(true)
  f.activity('U0', 20)
  expect(f.journal.view().blocked).toBe(true)
})
