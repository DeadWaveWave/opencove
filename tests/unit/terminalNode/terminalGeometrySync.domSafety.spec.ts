import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitInitialTerminalNodeGeometry,
  commitSettledTerminalNodeGeometry,
  fitTerminalNodeToMeasuredSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import {
  cleanupTerminalGeometrySyncTestWindow,
  createTerminalMock,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

describe('terminal geometry stable measurement', () => {
  beforeEach(() => {
    installTerminalGeometrySyncTestWindow()
  })

  afterEach(() => {
    cleanupTerminalGeometrySyncTestWindow()
  })

  it('preserves scroll offset when a placeholder is locally fitted before runtime attach', () => {
    const terminal = createTerminalMock()
    terminal.buffer.active.baseY = 220
    terminal.buffer.active.viewportY = 190
    terminal._core._bufferService.isUserScrolling = true
    terminal._core._bufferService.buffer.ydisp = 190

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 96, rows: 30 })),
        } as never,
      },
      containerRef: { current: { clientWidth: 760, clientHeight: 460 } as never },
      isPointerResizingRef: { current: false },
    })

    expect(size).toStrictEqual({ cols: 96, rows: 30 })
    expect(terminal.resize).toHaveBeenCalledWith(96, 30)
    expect(terminal.buffer.active.viewportY).toBe(190)
    expect(terminal._core._bufferService.isUserScrolling).toBe(true)
    expect(terminal._core._bufferService.buffer.ydisp).toBe(190)
    expect(terminal._core._viewport.scrollToLine).toHaveBeenCalledWith(190, true)
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('waits for stable measured geometry before the initial canonical commit', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }

    const size = await commitInitialTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi
            .fn()
            .mockReturnValueOnce({ cols: 80, rows: 24 })
            .mockReturnValueOnce({ cols: 132, rows: 41 })
            .mockReturnValueOnce({ cols: 132, rows: 41 }),
        } as never,
      },
      containerRef: { current: { clientWidth: 910, clientHeight: 620 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-initial-geometry',
      reason: 'frame_commit',
    })

    expect(size).toStrictEqual({ cols: 132, rows: 41, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 132, rows: 41 })
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-initial-geometry',
      cols: 132,
      rows: 41,
      reason: 'frame_commit',
      operationId: expect.any(String),
      baseGeometryRevision: null,
      authorityEpoch: null,
    })
  })

  it('keeps settling when mounted layout expands after early stable frames', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }

    const size = await commitInitialTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi
            .fn()
            .mockReturnValueOnce({ cols: 97, rows: 40 })
            .mockReturnValueOnce({ cols: 97, rows: 40 })
            .mockReturnValueOnce({ cols: 104, rows: 41 })
            .mockReturnValue({ cols: 104, rows: 41 }),
        } as never,
      },
      containerRef: { current: { clientWidth: 864, clientHeight: 624 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-initial-post-mount-expand',
      reason: 'frame_commit',
    })

    expect(size).toStrictEqual({ cols: 104, rows: 41, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 104, rows: 41 })
    expect(terminal.resize).toHaveBeenLastCalledWith(104, 41)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-initial-post-mount-expand',
      cols: 104,
      rows: 41,
      reason: 'frame_commit',
      operationId: expect.any(String),
      baseGeometryRevision: null,
      authorityEpoch: null,
    })
  })

  it('keeps measurement pure until the Worker accepts canonical geometry', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }

    const size = await commitInitialTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() =>
            terminal.cols < 97 ? { cols: 97, rows: 40 } : { cols: 104, rows: 41 },
          ),
        } as never,
      },
      containerRef: { current: { clientWidth: 864, clientHeight: 624 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-initial-local-settle-expand',
      reason: 'frame_commit',
    })

    expect(size).toStrictEqual({ cols: 97, rows: 40, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 97, rows: 40 })
    expect(terminal.resize).toHaveBeenCalledWith(97, 40)
    expect(terminal.resize).toHaveBeenCalledTimes(1)
    expect(ptyResize).toHaveBeenCalledTimes(1)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-initial-local-settle-expand',
      cols: 97,
      rows: 40,
      reason: 'frame_commit',
      operationId: expect.any(String),
      baseGeometryRevision: null,
      authorityEpoch: null,
    })
  })

  it('uses settled container and cell geometry for an appearance commit', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: { cols: 97, rows: 40 },
    }

    const size = await commitSettledTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi
            .fn()
            .mockReturnValueOnce({ cols: 97, rows: 40 })
            .mockReturnValueOnce({ cols: 97, rows: 40 })
            .mockReturnValueOnce({ cols: 104, rows: 41 })
            .mockReturnValue({ cols: 104, rows: 41 }),
        } as never,
      },
      containerRef: { current: { clientWidth: 864, clientHeight: 624 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-appearance-post-metrics-expand',
      reason: 'appearance_commit',
    })

    expect(size).toStrictEqual({ cols: 104, rows: 41, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 104, rows: 41 })
    expect(terminal.resize).toHaveBeenLastCalledWith(104, 41)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-appearance-post-metrics-expand',
      cols: 104,
      rows: 41,
      reason: 'appearance_commit',
      operationId: expect.any(String),
      baseGeometryRevision: null,
      authorityEpoch: null,
    })
  })
})
