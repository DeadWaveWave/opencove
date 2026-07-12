import { describe, expect, it, vi } from 'vitest'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'

describe('hydrateFromSnapshot terminal epoch transition', () => {
  it('keeps the previous terminal epoch in scrollback before revealing a new shell snapshot', async () => {
    const writes: string[] = []
    const terminal = {
      cols: 80,
      rows: 3,
      resize: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        writes.push(data)
        callback?.()
      }),
    }
    const onHydratedWriteCommitted = vi.fn()
    const finalizeHydration = vi.fn()

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'new-shell-epoch',
      terminal: terminal as never,
      kind: 'terminal',
      runtimeEpochChanged: true,
      cachedScreenState: null,
      persistedSnapshot: 'OLD_HISTORY\r\nOLD_PROMPT',
      presentationSnapshotPromise: Promise.resolve({
        sessionId: 'new-shell-epoch',
        epoch: 2,
        appliedSeq: 1,
        presentationRevision: 1,
        cols: 80,
        rows: 3,
        bufferKind: 'normal',
        cursor: { x: 2, y: 0 },
        title: 'shell',
        serializedScreen: 'NEW_PROMPT',
      }),
      takePtySnapshot: vi.fn(async () => ({ data: 'NEW_PROMPT' })),
      isDisposed: () => false,
      onHydratedWriteCommitted,
      finalizeHydration,
    })

    expect(writes[0]).toBe('OLD_HISTORY\r\nOLD_PROMPT')
    expect(writes.at(-1)).toBe('NEW_PROMPT')
    expect(writes.slice(1, -1).join('')).toContain('\r\n\r\n\r\n')
    expect(onHydratedWriteCommitted).toHaveBeenLastCalledWith(
      expect.stringContaining('OLD_HISTORY'),
    )
    expect(finalizeHydration).toHaveBeenCalledWith(expect.stringContaining('NEW_PROMPT'), {
      baselineAppliedSeq: 1,
    })
  })
})
