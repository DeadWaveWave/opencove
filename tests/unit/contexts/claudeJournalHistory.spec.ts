import { expect, it } from 'vitest'
import { ClaudeJournalHistory } from '../../../src/contexts/agent/application/ClaudeJournalHistory'
import { ClaudeInvocationJournal } from '../../../src/contexts/agent/application/ClaudeInvocationJournal'
import { ClaudeJournalProof } from '../../../src/contexts/agent/application/ClaudeJournalProof'
it('retains invocation identity tombstones independently of replay and saturates conservatively', () => {
  const h = new ClaudeJournalHistory()
  expect(h.remember('A', 1, 1)).toBe(false)
  for (let i = 0; i < 260; i++) {
    h.remember(`L${i}`, i + 2, i + 2)
  }
  expect(h.knows('A')).toBe(true)
  expect(h.remember('A', 500, 500)).toBe(true)
  expect(h.remember('fresh', 501, 501)).toBe(true)
  expect(h.incomplete).toBe(true)
  expect(h.qualifies(100)).toBe(false)
  expect(h.qualifies(500)).toBe(true)
  h.dispose()
  expect(h.incomplete).toBe(false)
  expect(h.remember('A', 1, 1)).toBe(false)
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
  for (let i = 0; i < 123; i++) {
    send('C', 'PermissionRequest', 60 + i)
  }
  send('C', 'Stop', 200)
  j.complete('C', undefined, 100200)
  now += 10000
  expect(j.events).toContain(unresolved)
  expect(j.events.some(f => f.id === 'B' && f.kind === 'end')).toBe(true)
  expect(new ClaudeJournalProof(j.events).epoch(unresolved)).toBeUndefined()
  expect(j.view()).toMatchObject({ ready: false, blocked: true })
})
it('never revives empty clear after truncation and requires a later current covering Stop', () => {
  let now = 100000
  const j = new ClaudeInvocationJournal(() => now)
  const start = (id: string, at: number) =>
    j.appendHook({
      claudeSessionId: id,
      hookEventName: 'SessionStart',
      emittedAtMs: 100000 + at,
      sessionStartSource: 'clear',
      state: null,
    })
  start('A', 10)
  for (let i = 0; i < 260; i++) {
    start(`L${i}`, 20 + i)
  }
  start('A', 500)
  now += 1000
  expect(j.view()).toMatchObject({ ready: false, blocked: true, historyIncomplete: true })
  j.appendHook({ claudeSessionId: 'A', hookEventName: 'Stop', emittedAtMs: 100600, state: 'done' })
  j.complete('A', undefined, 100600)
  expect(j.view()).toMatchObject({
    ready: true,
    blocked: false,
    completed: true,
    historyIncomplete: true,
  })
  start('new', 700)
  now += 1000
  expect(j.view()).toMatchObject({ ready: false, blocked: true, historyIncomplete: true })
})

it('uses authenticated relay order for a delayed predecessor with the same wire ID', () => {
  const h = new ClaudeJournalHistory()
  expect(h.remember('B', 210, 1)).toBe(false)
  expect(h.remember('B', 110, 2)).toBe(false)
  expect(h.possiblyReused('B', 210)).toBe(true)
  expect(h.possiblyReused('B', 110)).toBe(false)
})
it('does not let an earlier Stop acknowledged after truncation certify current idle', () => {
  const j = new ClaudeInvocationJournal(() => 100000)
  const start = (id: string, at: number) =>
    j.appendHook({
      claudeSessionId: id,
      hookEventName: 'SessionStart',
      sessionStartSource: 'clear',
      emittedAtMs: at,
      state: null,
    })
  start('A', 5000)
  j.appendHook({ claudeSessionId: 'A', hookEventName: 'Stop', emittedAtMs: 5100, state: 'done' })
  for (let i = 0; i < 65; i++) {
    start(`old-${i}`, 20 + i)
  }
  j.complete('A', undefined, 5100)
  expect(j.view()).toMatchObject({
    historyIncomplete: true,
    completed: true,
    ready: false,
    blocked: true,
  })
  j.appendHook({ claudeSessionId: 'A', hookEventName: 'Stop', emittedAtMs: 5200, state: 'done' })
  j.complete('A', undefined, 5200)
  expect(j.view()).toMatchObject({
    historyIncomplete: true,
    completed: true,
    ready: true,
    blocked: false,
  })
})
