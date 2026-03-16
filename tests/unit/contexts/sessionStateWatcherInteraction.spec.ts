import { describe, expect, it } from 'vitest'
import { shouldBroadcastOptimisticWorkingFromInteraction } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherInteraction'

describe('shouldBroadcastOptimisticWorkingFromInteraction', () => {
  it('marks codex submit as working immediately', () => {
    expect(
      shouldBroadcastOptimisticWorkingFromInteraction({
        provider: 'codex',
        data: '\r',
      }),
    ).toBe(true)
  })

  it('marks claude submit as working immediately', () => {
    expect(
      shouldBroadcastOptimisticWorkingFromInteraction({
        provider: 'claude-code',
        data: '\n',
      }),
    ).toBe(true)
  })

  it('ignores plain typing and shift-enter bytes', () => {
    expect(
      shouldBroadcastOptimisticWorkingFromInteraction({
        provider: 'codex',
        data: 'hello',
      }),
    ).toBe(false)

    expect(
      shouldBroadcastOptimisticWorkingFromInteraction({
        provider: 'codex',
        data: '\u001b\r',
      }),
    ).toBe(false)
  })

  it('does not apply optimistic submit handling to non-jsonl providers', () => {
    expect(
      shouldBroadcastOptimisticWorkingFromInteraction({
        provider: 'gemini',
        data: '\r',
      }),
    ).toBe(false)
  })
})
