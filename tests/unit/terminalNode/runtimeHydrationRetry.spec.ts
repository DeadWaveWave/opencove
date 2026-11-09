import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import { startRuntimeTerminalHydration } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/runtimeHydrationStarter'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'
import { subscribeRuntimeTerminalEvents } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.events'
import { createRuntimeTerminalInputBridge } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/createRuntimeTerminalInputBridge'
import { createTerminalCommandInputState } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/commandInput'
import { createRollingTextBuffer } from '../../../src/contexts/workspace/presentation/renderer/utils/rollingTextBuffer'

const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))
const text = (terminal: Terminal) =>
  Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true),
  ).join('\n')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('runtime hydration survives finite geometry churn', () => {
  it.each([
    'quiet period',
    'next acknowledged geometry event',
    'unmount',
    'session change',
    'unmount after acceptance',
    'session change during refetch',
  ])('recovers or cancels after 1 + 7 invalidations: %s', async trigger => {
    const sessionId = 'hydration-retry'
    const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    const worker = new TerminalPresentationSession({ sessionId, cols: 80, rows: 24 })
    const ptyWrite = vi.fn(async () => undefined)
    let onGeometry!: (event: {
      sessionId: string
      cols: number
      rows: number
      revision: number
    }) => void
    let onData!: (event: { sessionId: string; data: string; seq: number }) => void
    const buffer = () => createRollingTextBuffer({ maxChars: 100_000 })
    const scrollbackBuffer = buffer(),
      committedScrollbackBuffer = buffer()
    let disposed = false
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      opencoveApi: { pty: { write: ptyWrite } },
    })
    const inputBridge = createRuntimeTerminalInputBridge({
      terminal,
      sessionId,
      openTerminalFind: vi.fn(),
      onCommandRunRef: { current: undefined },
      onAgentOverlayExitRef: { current: undefined },
      commandInputStateRef: { current: createTerminalCommandInputState() },
      suppressPtyResizeRef: { current: false },
      syncTerminalSize: vi.fn(),
      shouldGateInitialUserInput: true,
      pendingUserInputBufferRef: { current: [{ data: 'GATED-INPUT', encoding: 'utf8' }] },
      recentUserInteractionAtRef: { current: Date.now() },
      inputDiagnosticsEnabled: false,
      terminalDiagnostics: { log: vi.fn() },
    })
    const finalized = vi.fn()
    const router = createTerminalHydrationRouter({
      terminal,
      outputScheduler: { handleChunk: data => terminal.write(data) },
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldDeferHydratedRedrawChunks: () => true,
      scrollbackBuffer,
      committedScrollbackBuffer,
      recordCommittedScreenState: vi.fn(),
      scheduleTranscriptSync: vi.fn(),
      ptyWriteQueue: inputBridge.ptyWriteQueue,
      markScrollbackDirty: vi.fn(),
      logHydrated: finalized,
      syncTerminalSize: vi.fn(),
      onRevealed: vi.fn(),
      isDisposed: () => disposed,
    })
    const unsubscribe = subscribeRuntimeTerminalEvents({
      terminal,
      sessionId,
      runtimeInputBridge: inputBridge,
      hydrationRouter: router,
      ptyEventHub: {
        onSessionGeometry: (_id: string, handler: typeof onGeometry) => {
          onGeometry = handler
          return vi.fn()
        },
        onSessionData: (_id: string, handler: typeof onData) => {
          onData = handler
          return vi.fn()
        },
        onSessionExit: () => vi.fn(),
        onSessionResync: () => vi.fn(),
      } as never,
      openCodeThemeBridge: null,
      diagnosticsEnabled: false,
      terminalDiagnostics: {} as never,
      restoredAgentVisibilityGate: { notifyOutputObserved: vi.fn() } as never,
      lastCommittedPtySizeRef: { current: null },
      syncTerminalSize: vi.fn(),
      scheduleTranscriptSync: vi.fn(),
      requestTerminalRendererRecovery: vi.fn(),
    })
    let disposeHydration: unknown
    let releaseRefetch!: () => void
    try {
      worker.resize(80, 24, 1)
      await worker.applyOutput(1, '\x1b[?1049h\x1b[?2004hBASELINE')
      let calls = 0
      const presentationSnapshot = vi.fn(async () => {
        calls += 1
        const snapshot = await worker.snapshot()
        if (calls <= 8) {
          worker.resize(80 + calls, 24, calls + 1)
          await worker.flush()
          onGeometry({ sessionId, cols: 80 + calls, rows: 24, revision: calls + 1 })
        } else if (calls === 9) {
          await worker.applyOutput(3, '\r\nUNCOVERED')
          onData({ sessionId, data: '\r\nUNCOVERED', seq: 3 })
          if (trigger === 'session change during refetch') {
            await new Promise<void>(resolve => {
              releaseRefetch = resolve
            })
          }
        }
        return snapshot
      })
      Object.assign(window.opencoveApi.pty, { presentationSnapshot })
      disposeHydration = startRuntimeTerminalHydration({
        terminal,
        sessionId,
        kind: 'agent',
        isLiveSessionReattach: true,
        attachPromise: Promise.resolve(undefined),
        presentationSnapshotPromise: presentationSnapshot(),
        shouldSkipInitialPlaceholderWrite: true,
        cachedScreenState: null,
        scrollbackBuffer,
        committedScrollbackBuffer,
        committedScreenStateRecorder: { record: vi.fn() },
        scheduleTranscriptSync: vi.fn(),
        hydrationBaselineSourceRef: { current: 'empty' },
        lastCommittedPtySizeRef: { current: null },
        runtimeInputBridge: inputBridge,
        hydrationRouter: router,
        scrollStateToRestore: null,
        shouldGateInitialUserInput: true,
        shouldAwaitAgentVisibleOutput: false,
        isDisposed: () => disposed,
      })
      await vi.waitFor(() => expect(presentationSnapshot).toHaveBeenCalledTimes(8))
      await write(terminal, '')
      expect(finalized).not.toHaveBeenCalled()
      expect(ptyWrite).not.toHaveBeenCalled()
      if (trigger === 'unmount' || trigger === 'session change') {
        expect(typeof disposeHydration).toBe('function')
        if (trigger === 'session change') {
          disposed = true
        }
        if (typeof disposeHydration === 'function') {
          disposeHydration()
        }
        onGeometry({ sessionId, cols: 88, rows: 24, revision: 10 })
        await new Promise(resolve => setTimeout(resolve, 150))
        expect(presentationSnapshot).toHaveBeenCalledTimes(8)
        expect(finalized).not.toHaveBeenCalled()
        expect(ptyWrite).not.toHaveBeenCalled()
        return
      }
      await worker.applyOutput(2, '\r\nAFTER-STABLE')
      onData({ sessionId, data: '\r\nAFTER-STABLE', seq: 2 })
      if (trigger === 'next acknowledged geometry event') {
        worker.resize(88, 24, 10)
        await worker.flush()
        onGeometry({ sessionId, cols: 88, rows: 24, revision: 10 })
      }
      if (trigger === 'session change during refetch') {
        await vi.waitFor(() => expect(presentationSnapshot).toHaveBeenCalledTimes(9))
        expect(typeof disposeHydration).toBe('function')
        disposed = true
        if (typeof disposeHydration === 'function') {
          disposeHydration()
        }
        releaseRefetch()
        await new Promise(resolve => setTimeout(resolve, 50))
        expect(finalized).not.toHaveBeenCalled()
        expect(ptyWrite).not.toHaveBeenCalled()
        return
      }
      await vi.waitFor(() => expect(text(terminal)).toContain('AFTER-STABLE'), { timeout: 2_000 })
      if (trigger === 'unmount after acceptance') {
        expect(typeof disposeHydration).toBe('function')
        if (typeof disposeHydration === 'function') {
          disposeHydration()
        }
        await new Promise(resolve => setTimeout(resolve, 1_050))
        expect(presentationSnapshot).toHaveBeenCalledTimes(9)
        expect(ptyWrite).not.toHaveBeenCalled()
        return
      }
      await vi.waitFor(
        () => expect(ptyWrite).toHaveBeenCalledWith({ sessionId, data: 'GATED-INPUT' }),
        { timeout: 2_000 },
      )
      expect(presentationSnapshot).toHaveBeenCalledTimes(9)
      expect(finalized).toHaveBeenCalledOnce()
      expect(text(terminal).match(/AFTER-STABLE/gu)).toHaveLength(1)
      expect(text(terminal).match(/UNCOVERED/gu)).toHaveLength(1)
      expect(terminal.buffer.active.type).toBe('alternate')
      expect(terminal.modes.bracketedPasteMode).toBe(true)
    } finally {
      disposed = true
      if (typeof disposeHydration === 'function') {
        disposeHydration()
      }
      releaseRefetch?.()
      unsubscribe()
      inputBridge.dispose()
      terminal.dispose()
      worker.dispose()
    }
  })
})
