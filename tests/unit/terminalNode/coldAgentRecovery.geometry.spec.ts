import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import { prepareRuntimePresentationAttach } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.support'
import { createRuntimeInitialGeometryCommitter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.initialGeometry'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'

describe('cold agent recovery across the first canonical resize', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['gemini', 'opencode'])(
    'keeps %s output already covered by the attach cursor',
    async provider => {
      const sessionId = `${provider}-resumed`
      const banner = `[opencove-test-agent] ${provider} resume`
      const worker = new TerminalPresentationSession({ sessionId, cols: 80, rows: 24 })
      const renderer = new Terminal({ allowProposedApi: true, cols: 80, rows: 24 })
      // Keep real parsing/serialization; no DOM paint is needed to prove content loss.
      vi.spyOn(renderer, 'refresh').mockImplementation(() => undefined)
      try {
        await worker.applyOutput(1, `${banner}\r\n`)
        const baseline = await worker.snapshot()
        expect(baseline.geometryRevision).toBeNull()
        const presentationSnapshot = vi.fn(async () => {
          if (presentationSnapshot.mock.calls.length === 2) {
            worker.commitGeometry({ cols: 64, rows: 20, baseGeometryRevision: null })
          }
          return worker.snapshot()
        })
        vi.stubGlobal('window', {
          opencoveApi: { pty: { presentationSnapshot } },
          // Only advance the snapshot polling wait; xterm's write queue remains real.
          setTimeout: (callback: () => void) => queueMicrotask(callback),
        })
        const attach = vi.fn(async () => undefined)
        const { attachPromise, presentationSnapshotPromise } = prepareRuntimePresentationAttach({
          ptyApi: { attach } as never,
          sessionId,
          isLiveSessionReattach: false,
          requirePostGeometrySnapshotOutput: true,
          commitInitialGeometry: createRuntimeInitialGeometryCommitter({
            terminalRef: { current: renderer },
            fitAddonRef: { current: null },
            containerRef: { current: null },
            isPointerResizingRef: { current: false },
            lastCommittedPtySizeRef: { current: null },
            sessionId,
          }),
        })
        const accepted = vi.fn()
        const rawSnapshot = vi.fn(async () => ({ data: banner }))
        await hydrateTerminalFromSnapshot({
          terminal: renderer,
          sessionId,
          kind: 'agent',
          useLivePtySnapshotDuringHydration: false,
          runtimeEpochChanged: true,
          attachPromise,
          presentationSnapshotPromise,
          persistedSnapshot: '',
          cachedScreenState: null,
          takePtySnapshot: rawSnapshot,
          isDisposed: () => false,
          onPresentationSnapshotAccepted: accepted,
          onHydratedWriteCommitted: vi.fn(),
          finalizeHydration: vi.fn(),
        })

        expect(attach).toHaveBeenCalledWith({ sessionId, afterSeq: baseline.appliedSeq })
        // The process is idle: resize changes presentation, not the output sequence.
        expect(await worker.snapshot()).toMatchObject({ appliedSeq: 1, geometryRevision: 1 })
        const lines = Array.from({ length: renderer.buffer.active.length }, (_, row) =>
          renderer.buffer.active.getLine(row)?.translateToString(true),
        ).join('\n')
        expect(lines).toContain(banner)
        expect(lines.split(banner)).toHaveLength(2)
        expect(accepted).toHaveBeenCalledWith(
          expect.objectContaining({ appliedSeq: 1, geometryRevision: 1, cols: 64, rows: 20 }),
        )
        expect(rawSnapshot).not.toHaveBeenCalled()
      } finally {
        worker.dispose()
        renderer.dispose()
      }
    },
  )
})
