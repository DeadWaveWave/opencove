import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import { prepareRuntimePresentationAttach } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.support'
import { createRuntimeInitialGeometryCommitter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.initialGeometry'
import { createRestoredAgentVisibilityGate } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/restoredAgentVisibilityGate'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'

describe('cold agent recovery across the first canonical resize', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['gemini', 'opencode', 'claude-code', 'codex'])(
    'renders %s history covered by the attach cursor and releases the recovery overlay',
    async provider => {
      const sessionId = `${provider}-resumed`
      const banner = ['claude-code', 'codex'].includes(provider)
        ? 'STARTUP_HISTORY_READY'
        : `[opencove-test-agent] ${provider} resume`
      const worker = new TerminalPresentationSession({ sessionId, cols: 80, rows: 24 })
      const renderer = new Terminal({ allowProposedApi: true, cols: 80, rows: 24 })
      // Keep real parsing/serialization; no DOM paint is needed to prove content loss.
      vi.spyOn(renderer, 'refresh').mockImplementation(() => undefined)
      const markHydrated = vi.fn()
      const releaseBufferedUserInput = vi.fn()
      const visibilityGate = createRestoredAgentVisibilityGate({
        terminal: renderer,
        shouldAwaitAgentVisibleOutput: true,
        shouldGateInitialUserInput: true,
        isDisposed: () => false,
        markHydrated,
        protectVisibleBaseline: vi.fn(),
        scheduleTranscriptSync: vi.fn(),
        reportThemeMode: vi.fn(),
        releaseBufferedUserInput,
        log: vi.fn(),
      })
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
          setTimeout,
          clearTimeout,
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
          finalizeHydration: visibilityGate.revealAfterHydration,
        })

        expect(attach).toHaveBeenCalledWith({ sessionId, afterSeq: baseline.appliedSeq })
        // The process is idle: resize changes presentation, not the output sequence.
        expect(await worker.snapshot()).toMatchObject({ appliedSeq: 1, geometryRevision: 1 })
        const lines = Array.from({ length: renderer.buffer.active.length }, (_, row) =>
          renderer.buffer.active.getLine(row)?.translateToString(true),
        ).join('\n')
        // This callback reveals the terminal and clears aria-busy in the runtime owner.
        // It must reveal committed content, without waiting for the observer's timeout.
        expect(markHydrated).toHaveBeenCalledTimes(1)
        expect(releaseBufferedUserInput).toHaveBeenCalledTimes(1)
        expect(lines).toContain(banner)
        expect(lines.split(banner)).toHaveLength(2)
        expect(accepted).toHaveBeenCalledWith(
          expect.objectContaining({ appliedSeq: 1, geometryRevision: 1, cols: 64, rows: 20 }),
        )
        expect(rawSnapshot).not.toHaveBeenCalled()
      } finally {
        visibilityGate.dispose()
        worker.dispose()
        renderer.dispose()
      }
    },
  )
})
