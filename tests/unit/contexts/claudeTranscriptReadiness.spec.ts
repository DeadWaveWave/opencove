import { expect, it } from 'vitest'
import { continuationFixture } from './claudeTurnContinuation.helpers'

it.each([false, true])(
  'ordinary turn completion ignores an unfinished transcript read without queue evidence (baseline=%s)',
  baseline => {
    const f = continuationFixture()
    try {
      f.hook('UserPromptSubmit', 'A')
      f.record({ kind: 'assistant', promptId: 'old', final: true }, { reading: true, baseline })
      if (baseline) {
        f.record({ kind: 'queue', operation: 'enqueue' }, { baseline, reading: true })
        f.record(
          { kind: 'user', promptId: 'old', promptSource: 'queued' },
          { baseline, reading: true },
        )
      }
      f.record(undefined, { unavailable: true })
      f.hook('Stop', 'A', 'final')
      expect(f.snapshot()).toMatchObject({
        state: 'idle',
        source: 'claude_hook',
        quality: 'authoritative',
        turn: null,
        lastEndedTurn: { id: 't1', outcome: 'completed' },
      })
      expect(f.read()).toMatchObject({ outcome: 'completed', message: 'final' })
      const snapshot = f.snapshot()
      const end = f.registry.readFence({ sessionId: 's' })?.lastTurnEnd
      f.record(undefined, { unavailable: true, fileIdentity: 'unavailable' })
      f.record(
        { kind: 'user', promptId: 'old', promptSource: 'queued' },
        { baseline: true, reading: true, fileIdentity: 'replacement' },
      )
      f.tick(5001)
      expect(f.snapshot()).toEqual(snapshot)
      expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toEqual(end)
    } finally {
      f.runtime.dispose()
    }
  },
)
