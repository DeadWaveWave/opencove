import { expect, it } from 'vitest'
import {
  ClaudeJournalReceipts,
  CLAUDE_RECEIPT_PROVENANCE_LIMIT,
} from '../../../src/contexts/agent/application/ClaudeJournalReceipts'
import { ClaudeJournalHistory } from '../../../src/contexts/agent/application/ClaudeJournalHistory'
import { ClaudeJournalProof } from '../../../src/contexts/agent/application/ClaudeJournalProof'
import type { JournalFact } from '../../../src/contexts/agent/application/ClaudeInvocationJournal'
const fact = (
  kind: JournalFact['kind'],
  at: number,
  order: number,
  promptId = 'p',
): JournalFact => ({
  kind,
  id: 'B',
  at,
  order,
  received: 0,
  promptId,
  key: `${kind}:${at}:${promptId}`,
  hookName: kind === 'activity' ? 'UserPromptSubmit' : kind === 'finish' ? 'Stop' : undefined,
})
it('keeps first-seen order across compaction, duplicates and provenance saturation', () => {
  const receipts = new ClaudeJournalReceipts(),
    history = new ClaudeJournalHistory()
  const stop = fact('finish', 500, 1),
    proof = new ClaudeJournalProof([])
  expect(receipts.observe(stop, 1, history, proof)).toBe(1)
  for (let i = 1; i <= CLAUDE_RECEIPT_PROVENANCE_LIMIT * 2; i++) {
    const order = receipts.observe(fact('finish', 500 + i, i + 1), i + 1, history, proof)
    expect(order).toBe(i < CLAUDE_RECEIPT_PROVENANCE_LIMIT ? i + 1 : 0)
  }
  expect(history.incomplete).toBe(true)
  expect(receipts.observe(stop, 10000, history, proof)).toBe(1)
  expect(receipts.observe(fact('finish', 99999, 10001), 10001, history, proof)).toBe(0)
  receipts.dispose()
  history.dispose()
  expect(receipts.observe(stop, 10002, history, proof)).toBe(10002)
})
it('certifies each fresh post-truncation pair once, including Stop-before-Submit delivery', () => {
  const receipts = new ClaudeJournalReceipts(),
    history = new ClaudeJournalHistory()
  const start = fact('start', 100, 1),
    submit = fact('activity', 200, 3),
    stop = fact('finish', 300, 2)
  const complete = { ...stop, kind: 'complete' as const, key: `complete:${stop.key}` }
  history.truncate(1)
  receipts.observe(stop, 2, history, new ClaudeJournalProof([start]))
  receipts.pair(new ClaudeJournalProof([start, complete]), history)
  expect(receipts.qualifies(complete, start, history)).toBe(false)
  receipts.observe(submit, 3, history, new ClaudeJournalProof([start]))
  receipts.pair(new ClaudeJournalProof([start, complete, submit]), history)
  expect(receipts.qualifies(complete, start, history)).toBe(true)
  const again = fact('finish', 400, 4),
    completedAgain = { ...again, kind: 'complete' as const, key: `complete:${again.key}` }
  receipts.observe(again, 4, history, new ClaudeJournalProof([start]))
  receipts.pair(new ClaudeJournalProof([start, completedAgain]), history)
  expect(receipts.qualifies(completedAgain, start, history)).toBe(false)
  expect(receipts.qualifies(complete, fact('start', 150, 5), history)).toBe(false)
})
it('never rebinds an old Stop to a reused namespace or replays an old Submit as fresh', () => {
  const receipts = new ClaudeJournalReceipts(),
    history = new ClaudeJournalHistory()
  const old = fact('start', 20, 1),
    stop = fact('finish', 500, 2),
    submit = fact('activity', 450, 4)
  receipts.observe(stop, 2, history, new ClaudeJournalProof([old]))
  history.truncate(3)
  const start = fact('start', 400, 3)
  receipts.observe(submit, 4, history, new ClaudeJournalProof([start]))
  const complete = { ...stop, kind: 'complete' as const, key: `complete:${stop.key}` }
  receipts.pair(new ClaudeJournalProof([start, complete, submit]), history)
  expect(receipts.qualifies(complete, start, history)).toBe(false)
  expect(receipts.observe(stop, 5, history, new ClaudeJournalProof([start]))).toBe(2)
  const pre = fact('activity', 460, 1, 'old')
  receipts.observe(pre, 1, history, new ClaudeJournalProof([start]))
  expect(receipts.observe(pre, 6, history, new ClaudeJournalProof([start]))).toBe(1)
})
