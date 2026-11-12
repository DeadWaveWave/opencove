import { describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult } from '../../../src/shared/contracts/dto'
import { applyPresentationSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/applyPresentationSnapshot'
import { markTerminalGeometryAccepted } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator'

const snapshot: PresentationSnapshotTerminalResult = {
  sessionId: 'snapshot-application',
  epoch: 1,
  appliedSeq: 1,
  presentationRevision: 1,
  cols: 60,
  rows: 20,
  geometryRevision: 8,
  bufferKind: 'normal',
  cursor: { x: 0, y: 0 },
  title: null,
  serializedScreen: 'STALE',
}

describe('bounded snapshot application', () => {
  it('keeps acknowledged geometry and does not commit or reveal an obsolete snapshot on exhaustion', async () => {
    const terminal = new Terminal({ cols: 100, rows: 30, allowProposedApi: true })
    try {
      markTerminalGeometryAccepted(terminal, 9)
      const apply = vi.fn(async () => snapshot.serializedScreen),
        onAccepted = vi.fn()
      const refetch = vi.fn(async () => snapshot)
      expect(
        await applyPresentationSnapshot({
          terminal,
          sessionId: snapshot.sessionId,
          snapshot,
          apply,
          onAccepted,
          refetch,
          maxAttempts: 3,
          isDisposed: () => false,
        }),
      ).toBe(false)
      expect(apply).not.toHaveBeenCalled()
      expect(onAccepted).not.toHaveBeenCalled()
      expect(refetch).toHaveBeenCalledTimes(2)
      expect([terminal.cols, terminal.rows]).toEqual([100, 30])
    } finally {
      terminal.dispose()
    }
  })

  it('refetches a foreign session payload even when its epoch and revision match', async () => {
    const terminal = new Terminal({ allowProposedApi: true })
    try {
      const apply = vi.fn(async candidate => candidate.serializedScreen)
      const onAccepted = vi.fn(),
        refetch = vi.fn(async () => snapshot)
      expect(
        await applyPresentationSnapshot({
          terminal,
          sessionId: snapshot.sessionId,
          snapshot: { ...snapshot, sessionId: 'foreign-session-with-epoch-1' },
          apply,
          onAccepted,
          refetch,
          isDisposed: () => false,
        }),
      ).toBe(true)
      expect(apply).toHaveBeenCalledExactlyOnceWith(snapshot)
      expect(refetch).toHaveBeenCalledOnce()
    } finally {
      terminal.dispose()
    }
  })
})
