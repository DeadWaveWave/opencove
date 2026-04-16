import { describe, expect, it, vi } from 'vitest'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'

describe('hydrateFromSnapshot', () => {
  it('uses the live PTY snapshot for agent live reattach hydration', async () => {
    const terminal = {
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        return data
      }),
    }
    const onHydratedWriteCommitted = vi.fn()
    const finalizeHydration = vi.fn()
    const takePtySnapshot = vi.fn(async () => ({ data: 'live agent output' }))

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'agent-session-1',
      terminal: terminal as never,
      kind: 'agent',
      useLivePtySnapshotDuringHydration: true,
      cachedScreenState: null,
      persistedSnapshot: '',
      takePtySnapshot,
      isDisposed: () => false,
      onHydratedWriteCommitted,
      finalizeHydration,
    })

    expect(takePtySnapshot).toHaveBeenCalledWith({ sessionId: 'agent-session-1' })
    expect(terminal.write).toHaveBeenCalledWith('live agent output', expect.any(Function))
    expect(onHydratedWriteCommitted).toHaveBeenCalledWith('live agent output')
    expect(finalizeHydration).toHaveBeenCalledWith('live agent output')
  })
})
