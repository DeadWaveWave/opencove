import { describe, expect, it, vi } from 'vitest'
import { createPtyStreamPresentationResetBarrier } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamService.presentationResetBarrier'

const SNAPSHOT = {
  sessionId: 'session-reset',
  epoch: 1,
  appliedSeq: 4,
  presentationRevision: 1,
  cols: 80,
  rows: 24,
  geometryRevision: 1,
  bufferKind: 'normal' as const,
  cursor: { x: 0, y: 0 },
  title: null,
  serializedScreen: 'RESET_SCREEN',
}

describe('PtyStream presentation reset barrier', () => {
  it('marks recovery dirty after apply when the runtime has no settlement hook', async () => {
    const onCommitted = vi.fn()
    const barrier = createPtyStreamPresentationResetBarrier({
      expectsCommit: false,
      applyReset: vi.fn(async () => undefined),
      onCommitted,
    })

    await barrier.apply({ sessionId: 'session-reset', snapshot: SNAPSHOT })

    expect(onCommitted).toHaveBeenCalledWith('session-reset')
  })

  it('releases shutdown without dirtying recovery when a reset settles as aborted', async () => {
    const onCommitted = vi.fn()
    const barrier = createPtyStreamPresentationResetBarrier({
      expectsCommit: true,
      applyReset: vi.fn(async () => undefined),
      onCommitted,
    })
    const applied = barrier.apply({ sessionId: 'session-reset', snapshot: SNAPSHOT })
    await applied
    const drain = barrier.drainAndStopAccepting()

    barrier.settle({ sessionId: 'session-reset', committed: false })
    await drain

    expect(onCommitted).not.toHaveBeenCalled()
  })
})
