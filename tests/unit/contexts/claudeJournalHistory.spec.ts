import { expect, it } from 'vitest'
import {
  ClaudeJournalHistory,
  CLAUDE_IDENTITY_LIMIT,
} from '../../../src/contexts/agent/application/ClaudeJournalHistory'
import { ClaudeInvocationJournal } from '../../../src/contexts/agent/application/ClaudeInvocationJournal'
import { ClaudeJournalProof } from '../../../src/contexts/agent/application/ClaudeJournalProof'
it('retains identity tombstones and never clears saturation before disposal', () => {
  const h = new ClaudeJournalHistory()
  expect(h.remember('A', 1)).toBe(false)
  for (let i = 0; i < 260; i++) {
    h.remember(`L${i}`, i + 2)
  }
  expect(h.knows('A')).toBe(true)
  expect(h.remember('A', 500)).toBe(true)
  expect(h.remember('fresh', 501)).toBe(true)
  expect(h.incomplete).toBe(true)
  h.dispose()
  expect(h.incomplete).toBe(false)
  expect(h.remember('A', 1)).toBe(false)
})
it('pins all End/Start witnesses while successor evidence is unresolved', () => {
  let now = 100000
  const j = new ClaudeInvocationJournal(() => now)
  const send = (id: string, name: string, at: number) =>
    j.appendHook({
      claudeSessionId: id,
      hookEventName: name,
      emittedAtMs: 100000 + at,
      sessionStartSource: name === 'SessionStart' ? 'clear' : undefined,
      sessionEndReason: name === 'SessionEnd' ? 'clear' : undefined,
      state:
        name === 'UserPromptSubmit'
          ? 'working'
          : name === 'PermissionRequest'
            ? 'waiting'
            : name === 'Stop'
              ? 'done'
              : null,
    })
  send('B', 'SessionStart', 20)
  send('B', 'SessionEnd', 30)
  send('B', 'UserPromptSubmit', 50)
  send('C', 'SessionStart', 40)
  const unresolved = j.events.find(f => f.id === 'B' && f.kind === 'activity')!
  expect(new ClaudeJournalProof(j.events).epoch(unresolved)).toBeUndefined()
  for (let i = 0; i < 635; i++) {
    send('C', 'PermissionRequest', 60 + i)
  }
  send('C', 'Stop', 1000)
  j.complete('C', undefined, 101000)
  now += 10000
  expect(j.events).toContain(unresolved)
  expect(j.events.some(f => f.id === 'B' && f.kind === 'end')).toBe(true)
  expect(new ClaudeJournalProof(j.events).epoch(unresolved)).toBeUndefined()
  expect(j.view()).toMatchObject({ ready: false, blocked: true })
})
it.each([255, 256, 520])(
  'refuses for the invocation after %s distinct successors, including fresh completion',
  count => {
    let now = 100000
    const j = new ClaudeInvocationJournal(() => now)
    const start = (id: string, at: number) =>
      j.appendHook({
        claudeSessionId: id,
        hookEventName: 'SessionStart',
        emittedAtMs: at,
        sessionStartSource: 'clear',
        state: null,
      })
    start('A', 1)
    for (let n = 0; n < count; n++) {
      start(`L${n}`, n + 2)
    }
    now += 1000
    const saturated = count >= CLAUDE_IDENTITY_LIMIT
    expect(j.view()).toMatchObject({ ready: !saturated, historyIncomplete: saturated })
    j.appendHook({
      claudeSessionId: `L${count - 1}`,
      hookEventName: 'UserPromptSubmit',
      emittedAtMs: 2000,
      state: 'working',
    })
    j.appendHook({
      claudeSessionId: `L${count - 1}`,
      hookEventName: 'Stop',
      emittedAtMs: 2010,
      state: 'done',
    })
    j.complete(`L${count - 1}`, undefined, 2010)
    expect(j.view()).toMatchObject({
      ready: !saturated,
      blocked: saturated,
      completed: true,
      historyIncomplete: saturated,
    })
    now += 10000
    expect(j.view().ready).toBe(!saturated)
  },
)

it('uses authenticated relay order to recognize a reused ID', () => {
  const h = new ClaudeJournalHistory()
  expect(h.remember('B', 210)).toBe(false)
  expect(h.remember('B', 110)).toBe(false)
  expect(h.possiblyReused('B', 210)).toBe(true)
  expect(h.possiblyReused('B', 110)).toBe(false)
})
it('disposes terminal saturation only with the invocation', () => {
  const j = new ClaudeInvocationJournal(() => 100000)
  for (let n = 0; n < 520; n++) {
    j.appendHook({
      claudeSessionId: `L${n}`,
      hookEventName: 'SessionStart',
      emittedAtMs: n,
      sessionStartSource: 'clear',
      state: null,
    })
  }
  expect(j.view()).toMatchObject({ ready: false, blocked: true, historyIncomplete: true })
  j.dispose()
  expect(j.view().ready).toBe(false)
  const next = new ClaudeInvocationJournal(() => 100000)
  next.appendHook({
    claudeSessionId: 'L0',
    hookEventName: 'SessionStart',
    emittedAtMs: 1,
    sessionStartSource: 'clear',
    state: null,
  })
  expect(next.view(101000)).toMatchObject({ ready: true, historyIncomplete: false })
})
