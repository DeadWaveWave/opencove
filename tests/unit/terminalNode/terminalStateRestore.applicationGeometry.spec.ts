import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'
import { requestPresentationSnapshotAfterGeometry } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/presentationSnapshotGeometry'
import { commitTerminalGeometryForCurrentSession } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useCommittedTerminalGeometry'
import {
  beginTerminalGeometryCommit,
  getTerminalGeometryCommitRequest,
  markTerminalGeometryAccepted,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator'
import { readTerminalEmulationStateForTest } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRenderTestProbe'
import { subscribeRuntimeTerminalEvents } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.events'
import {
  cleanupTerminalGeometrySyncTestWindow,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))

describe('snapshot geometry at application time', () => {
  beforeEach(installTerminalGeometrySyncTestWindow)
  afterEach(cleanupTerminalGeometrySyncTestWindow)

  it.each(['capture delivery', 'parser fence', 'snapshot write', 'geometry event during write'])(
    'does not roll revision 9 back to revision 8 after %s (request floor 7)',
    async timing => {
      const sessionId = 'application-geometry'
      const worker = new TerminalPresentationSession({ sessionId, cols: 80, rows: 24 })
      const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
      vi.spyOn(terminal, 'refresh').mockImplementation(() => undefined)
      try {
        worker.resize(80, 24, 7)
        await worker.applyOutput(1, '\x1b[?1049h\x1b[?2004hHISTORY')
        markTerminalGeometryAccepted(terminal, 7)
        worker.resize(60, 20, 8)
        const captured = await worker.snapshot()
        const finalized = vi.fn(),
          accepted = vi.fn()
        let acknowledged9 = false
        const originalResize = terminal.resize.bind(terminal)
        const rollbacks: number[][] = []
        vi.spyOn(terminal, 'resize').mockImplementation((cols, rows) => {
          if (acknowledged9 && (cols !== 100 || rows !== 30)) {
            rollbacks.push([cols, rows])
          }
          originalResize(cols, rows)
        })
        ptyResize.mockImplementation(async payload => {
          worker.resize(100, 30, 9)
          await worker.flush()
          return {
            sessionId,
            operationId: payload.operationId,
            status: 'accepted',
            changed: true,
            geometry: { cols: 100, rows: 30, revision: 9 },
            authority: { role: 'controller', epoch: 1 },
          }
        })
        const advance9 = async () => {
          if (timing === 'geometry event during write') {
            worker.resize(100, 30, 9)
            await worker.flush()
            let geometryEvent!: (event: {
              sessionId: string
              cols: number
              rows: number
              revision: number
            }) => void
            const unsubscribe = subscribeRuntimeTerminalEvents({
              terminal,
              sessionId,
              ptyEventHub: {
                onSessionData: () => vi.fn(),
                onSessionExit: () => vi.fn(),
                onSessionResync: () => vi.fn(),
                onSessionGeometry: (_id: string, handler: typeof geometryEvent) => {
                  geometryEvent = handler
                  return vi.fn()
                },
              } as never,
              openCodeThemeBridge: null,
              runtimeInputBridge: {} as never,
              diagnosticsEnabled: false,
              terminalDiagnostics: {} as never,
              restoredAgentVisibilityGate: {} as never,
              hydrationRouter: {} as never,
              lastCommittedPtySizeRef: { current: null },
              syncTerminalSize: vi.fn(),
              scheduleTranscriptSync: vi.fn(),
              requestTerminalRendererRecovery: vi.fn(),
            })
            geometryEvent({ sessionId, cols: 100, rows: 30, revision: 9 })
            unsubscribe()
            acknowledged9 = true
            return
          }
          await commitTerminalGeometryForCurrentSession(
            {
              terminalRef: { current: terminal },
              fitAddonRef: {
                current: { proposeDimensions: () => ({ cols: 100, rows: 30 }) } as never,
              },
              containerRef: { current: { clientWidth: 800, clientHeight: 500 } as HTMLElement },
              isPointerResizingRef: { current: false },
              lastCommittedPtySizeRef: { current: null },
              suppressPtyResizeRef: { current: false },
              latestSessionIdRef: { current: sessionId },
              sessionId,
              scheduleWebglCanvasTransformCleanup: vi.fn(),
            },
            'appearance_commit',
          )
          acknowledged9 = true
        }
        const originalWrite = terminal.write.bind(terminal)
        let intercepted = false
        vi.spyOn(terminal, 'write').mockImplementation((data, callback) => {
          const intercept =
            !intercepted &&
            ((timing === 'parser fence' && data === '') ||
              ((timing === 'snapshot write' || timing === 'geometry event during write') &&
                typeof data === 'string' &&
                data.includes('HISTORY')))
          if (intercept) {
            intercepted = true
            originalWrite(data, () => {
              void advance9().then(() => callback?.())
            })
          } else {
            originalWrite(data, callback)
          }
        })
        let calls = 0
        const requestSnapshot = vi.fn(async () => {
          calls += 1
          if (calls === 1) {
            if (timing === 'capture delivery') {
              await advance9()
            }
            return captured
          }
          return worker.snapshot()
        })
        Object.assign(window.opencoveApi.pty, { presentationSnapshot: requestSnapshot })
        const pending = requestPresentationSnapshotAfterGeometry({
          sessionId,
          expectedGeometry: { cols: 80, rows: 24, geometryRevision: 7 },
          requestSnapshot,
        })
        await hydrateTerminalFromSnapshot({
          terminal,
          sessionId,
          kind: 'agent',
          attachPromise: Promise.resolve(undefined),
          presentationSnapshotPromise: pending,
          cachedScreenState: null,
          persistedSnapshot: '',
          takePtySnapshot: vi.fn(),
          isDisposed: () => false,
          onHydratedWriteCommitted: vi.fn(),
          onPresentationSnapshotAccepted: accepted,
          finalizeHydration: finalized,
        })
        await write(terminal, '')
        expect.soft({ cols: terminal.cols, rows: terminal.rows }).toEqual({ cols: 100, rows: 30 })
        expect.soft(rollbacks).toEqual([])
        expect.soft(accepted).toHaveBeenCalledOnce()
        expect.soft(accepted).toHaveBeenCalledWith(expect.objectContaining({ geometryRevision: 9 }))
        expect.soft(requestSnapshot).toHaveBeenCalledTimes(2)
        expect(readTerminalEmulationStateForTest(terminal)).toMatchObject({
          bufferKind: 'alternate',
          bracketedPasteMode: true,
        })
        const revision = beginTerminalGeometryCommit(terminal)
        expect(getTerminalGeometryCommitRequest(terminal, revision)?.baseGeometryRevision).toBe(9)
        expect(finalized).toHaveBeenCalledOnce()
      } finally {
        worker.dispose()
        terminal.dispose()
      }
    },
  )
})
