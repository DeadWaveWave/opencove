import { expect, it } from 'vitest'
import {
  ClaudeJournalReceipts,
  CLAUDE_RECEIPT_PROVENANCE_LIMIT,
} from '../../../src/contexts/agent/application/ClaudeJournalReceipts'
import { ClaudeJournalHistory } from '../../../src/contexts/agent/application/ClaudeJournalHistory'
import {
  ClaudeInvocationJournal,
  type JournalFact,
} from '../../../src/contexts/agent/application/ClaudeInvocationJournal'
const fact = (kind: JournalFact['kind'], at: number): JournalFact => ({
  kind,
  id: 'B',
  at,
  received: 0,
  key: `${kind}:${at}`,
})
it('keeps first-seen order across compaction, duplicates and terminal provenance saturation', () => {
  const receipts = new ClaudeJournalReceipts(),
    history = new ClaudeJournalHistory(),
    stop = fact('finish', 500)
  expect(receipts.observe(stop, 1, history, 20)).toBe(1)
  for (let i = 1; i <= CLAUDE_RECEIPT_PROVENANCE_LIMIT * 2; i++) {
    expect(receipts.observe(fact('finish', 500 + i), i + 1, history, 20)).toBe(
      i < CLAUDE_RECEIPT_PROVENANCE_LIMIT ? i + 1 : 0,
    )
  }
  expect(history.incomplete).toBe(true)
  expect(receipts.observe(stop, 10000, history, 400)).toBe(1)
  expect(receipts.belongs(stop.key, 20)).toBe(true)
  expect(receipts.belongs(stop.key, 400)).toBe(false)
  receipts.dispose()
  history.dispose()
  expect(receipts.observe(stop, 10002, history, 400)).toBe(10002)
})
it('records rejected hooks before any fact is appended and cannot rebind their namespace', () => {
  const journal = new ClaudeInvocationJournal(() => 100000)
  const start = (id: string, at: number) =>
    journal.appendHook({
      claudeSessionId: id,
      hookEventName: 'SessionStart',
      emittedAtMs: at,
      state: null,
      sessionStartSource: 'clear',
    })
  start('B', 20)
  start('C', 100)
  for (const [name, at, state] of [
    ['UserPromptSubmit', 450, 'working'],
    ['Stop', 500, 'done'],
  ] as const) {
    const event = {
      claudeSessionId: 'B',
      hookEventName: name,
      emittedAtMs: at,
      state,
      promptId: 'old',
    }
    expect(journal.observeReceipt(event)).toBe(false)
    expect(journal.observeReceipt(event)).toBe(true)
    expect(journal.events.some(f => f.key.includes(name))).toBe(false)
    expect(journal.rejectsReceipt(event)).toBe(true)
  }
  start('B', 400)
  for (const name of ['UserPromptSubmit', 'Stop']) {
    expect(
      journal.rejectsReceipt({
        claudeSessionId: 'B',
        hookEventName: name,
        emittedAtMs: name === 'Stop' ? 500 : 450,
        state: name === 'Stop' ? 'done' : 'working',
        promptId: 'old',
      }),
    ).toBe(true)
  }
})
it('does not bind pre-clear receipts to a provisional ordinary identity', () => {
  const receipts = new ClaudeJournalReceipts(),
    history = new ClaudeJournalHistory(),
    stop = fact('finish', 500)
  receipts.observe(stop, 1, history)
  expect(receipts.belongs(stop.key, 400)).toBe(true)
  expect(history.incomplete).toBe(false)
})
