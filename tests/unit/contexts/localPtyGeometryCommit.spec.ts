import { createLocalPtyGeometryCommitter } from '../../../src/contexts/terminal/presentation/main-ipc/localPtyGeometryCommit'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import type { ResizeTerminalInput } from '../../../src/shared/contracts/dto'

describe('local runtime geometry confirmation', () => {
  it.each(['unverified', 'throw'] as const)(
    'retries the canonical size after %s',
    async failure => {
      const presentation = new TerminalPresentationSession({
        sessionId: 'session',
        cols: 80,
        rows: 24,
      })
      const resizeRuntime = vi
        .fn<Parameters<typeof createLocalPtyGeometryCommitter>[0]['resizeRuntime']>()
        .mockImplementation(async (_sessionId, cols, rows) => ({
          status: 'applied_verified',
          cols,
          rows,
        }))
      if (failure === 'throw') {
        resizeRuntime.mockRejectedValueOnce(new Error('lost observation'))
      } else {
        resizeRuntime.mockResolvedValueOnce({ status: 'applied_unverified' })
      }
      const committer = createLocalPtyGeometryCommitter({
        manager: {
          resolveSessionLifecycleState: () => 'active' as const,
          resolveActivePresentationSessionIdentity: () => presentation,
          getGeometry: () => presentation.getGeometry(),
          planGeometryCommit: (input: ResizeTerminalInput) =>
            presentation.planGeometryCommit(input),
          commitGeometry: (input: ResizeTerminalInput) => presentation.commitGeometry(input),
        },
        resizeRuntime,
        log: vi.fn(),
      })
      await committer.resize({ sessionId: 'session', cols: 120, rows: 40 })
      const retry = await committer.resize({ sessionId: 'session', cols: 80, rows: 24 })
      expect(retry).toMatchObject({
        status: 'accepted',
        changed: false,
        geometry: { cols: 80, rows: 24 },
      })
      expect(resizeRuntime).toHaveBeenCalledTimes(2)
      await committer.resize({ sessionId: 'session', cols: 80, rows: 24 })
      expect(resizeRuntime).toHaveBeenCalledTimes(2)
      committer.dispose()
      presentation.dispose()
    },
  )
})
