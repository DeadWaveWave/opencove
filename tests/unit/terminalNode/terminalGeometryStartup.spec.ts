import type { ResizeTerminalInput, TerminalGeometryCommitResult } from '@shared/contracts/dto'
import { TERMINAL_GEOMETRY_ACK_TIMEOUT_MS } from '@shared/runtime/terminalGeometryTimeouts'
import { WindowsPtyResizeOwner } from '@platform/process/ptyHost/windowsPtyResizeOwner'
import { createRemotePtyRuntimeGeometryCoordinator } from '../../../src/app/main/controlSurface/remote/remotePtyRuntime.geometryCoordinator'
import { BrowserPtyGeometryAckCoordinator } from '../../../src/app/renderer/browser/BrowserPtyGeometryAckCoordinator'
import { createRuntimeInitialGeometryCommitter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.initialGeometry'
import { requestTerminalGeometryCommitAck } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCommitAck'
import {
  canWriteTerminalOutput,
  hasTerminalGeometryCommitFailed,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator'
import {
  cleanupTerminalGeometrySyncTestWindow,
  createTerminalMock,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

describe('cold Windows resize through client acknowledgement deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installTerminalGeometrySyncTestWindow()
    Object.assign(window, { setTimeout, clearTimeout })
  })
  afterEach(() => {
    cleanupTerminalGeometrySyncTestWindow()
    vi.useRealTimers()
  })

  it('still bounds a missing transport result and clears the acknowledgement timer', async () => {
    ptyResize.mockImplementation(() => new Promise(() => undefined))
    const result = expect(
      requestTerminalGeometryCommitAck({
        terminal: null,
        sessionId: 'hung-transport',
        cols: 65,
        rows: 44,
        reason: 'frame_commit',
      }),
    ).rejects.toThrow(/geometry commit timed out/)
    await vi.advanceTimersByTimeAsync(TERMINAL_GEOMETRY_ACK_TIMEOUT_MS)
    await result
    expect(ptyResize).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['desktop', 'browser'] as const)(
    'keeps the %s initial commit pending until startup and real confirmation finish',
    async transport => {
      const pty = { pid: 42, resize: vi.fn() }
      const owner = new WindowsPtyResizeOwner(pty, {
        ensureReady: async () => undefined,
        read: async () => ({ cols: 65, rows: 44 }),
      })
      const relay = createRemotePtyRuntimeGeometryCoordinator()
      const browser = new BrowserPtyGeometryAckCoordinator()
      const terminal = createTerminalMock()
      const lastCommittedPtySizeRef = { current: { cols: 80, rows: 24 } }
      const complete = async (
        input: ResizeTerminalInput,
      ): Promise<TerminalGeometryCommitResult> => {
        try {
          await owner.resize(input.cols, input.rows)
          return {
            sessionId: input.sessionId,
            operationId: input.operationId!,
            status: 'accepted',
            changed: true,
            geometry: { cols: input.cols, rows: input.rows, revision: 1 },
            authority: { role: 'controller', epoch: 1 },
          }
        } catch {
          return {
            sessionId: input.sessionId,
            operationId: input.operationId!,
            status: 'runtime_failed',
            changed: false,
            geometry: null,
            authority: null,
          }
        }
      }
      ptyResize.mockImplementation((input: ResizeTerminalInput) => {
        if (transport === 'browser') {
          const pending = browser.begin({ ...input, legacyRevision: null })
          void complete(input).then(result => browser.resolveTyped({ ...result }))
          return pending.result
        }
        return relay.resize({
          request: input,
          authority: { role: 'controller', epoch: 1 },
          timeoutMs: 3_000,
          send: async () => {
            void complete(input).then(result => relay.handleResizeResult(result))
          },
        })
      })
      const commit = createRuntimeInitialGeometryCommitter({
        terminalRef: { current: terminal as never },
        fitAddonRef: { current: { proposeDimensions: () => ({ cols: 65, rows: 44 }) } as never },
        containerRef: { current: { clientWidth: 640, clientHeight: 660 } as never },
        isPointerResizingRef: { current: false },
        lastCommittedPtySizeRef,
        sessionId: 'cold-start',
        preferMeasuredGeometryCommit: true,
      })
      const result = commit(null)
      try {
        await vi.advanceTimersByTimeAsync(4_000)
        expect(hasTerminalGeometryCommitFailed(terminal as never)).toBe(false)
        expect(canWriteTerminalOutput(terminal as never)).toBe(false)
        expect(pty.resize).not.toHaveBeenCalled()
        owner.markReady()
        await vi.advanceTimersByTimeAsync(0)
        await expect(result).resolves.toMatchObject({ cols: 65, rows: 44 })
        expect(terminal.resize).toHaveBeenCalledExactlyOnceWith(65, 44)
        expect(lastCommittedPtySizeRef.current).toEqual({ cols: 65, rows: 44 })
        expect(hasTerminalGeometryCommitFailed(terminal as never)).toBe(false)
        expect(canWriteTerminalOutput(terminal as never)).toBe(true)
        expect(ptyResize).toHaveBeenCalledOnce()
      } finally {
        owner.dispose()
        relay.clear()
        browser.rejectAll(new Error('test disposed'))
        await result
      }
      expect(vi.getTimerCount()).toBe(0)
    },
  )
})
