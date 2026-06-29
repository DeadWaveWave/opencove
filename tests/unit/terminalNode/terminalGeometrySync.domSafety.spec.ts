import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitInitialTerminalNodeGeometry,
  commitSettledTerminalNodeGeometry,
  createTerminalDomTextOverhangGeometryCommitScheduler,
  fitTerminalNodeToMeasuredSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import {
  cleanupTerminalGeometrySyncTestWindow,
  createDomLayoutContainerMock,
  createTerminalMock,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

describe('terminal geometry DOM safety helpers', () => {
  beforeEach(() => {
    installTerminalGeometrySyncTestWindow()
  })

  afterEach(() => {
    cleanupTerminalGeometrySyncTestWindow()
  })

  it('keeps a one-cell visual gap from the DOM renderer screen to the scrollbar after calibration', () => {
    const terminal = createTerminalMock()
    terminal.cols = 117
    terminal.rows = 36
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.145299145299146,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 117, rows: 36 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 867,
          xtermWidth: 867,
          screenWidth: 836,
          rowsScrollWidth: 867,
          maxRowRight: 844,
          scrollbarLeft: 849.4,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 117, rows: 36 } },
    })

    expect(size).toStrictEqual({ cols: 116, rows: 36 })
    expect(terminal.resize).toHaveBeenCalledWith(116, 36)
  })

  it('keeps an extra visual gap from DOM renderer glyph overhang to the scrollbar after calibration', () => {
    const terminal = createTerminalMock()
    terminal.cols = 117
    terminal.rows = 36
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.145299145299146,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 117, rows: 36 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 867,
          xtermWidth: 867,
          screenWidth: 836,
          rowsScrollWidth: 836,
          maxRowRight: 844,
          maxSpanRight: 851.8,
          scrollbarLeft: 852,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 117, rows: 36 } },
    })

    expect(size).toStrictEqual({ cols: 115, rows: 36 })
    expect(terminal.resize).toHaveBeenCalledWith(115, 36)
  })

  it('only removes the DOM renderer columns needed for a one-cell scrollbar gap', () => {
    const terminal = createTerminalMock()
    terminal.cols = 117
    terminal.rows = 36
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.145299145299146,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 117, rows: 36 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 867,
          xtermWidth: 867,
          screenWidth: 836,
          rowsScrollWidth: 867,
          maxRowRight: 844,
          scrollbarLeft: 849.4,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 117, rows: 36 } },
    })

    expect(size).toStrictEqual({ cols: 116, rows: 36 })
    expect(terminal.resize).toHaveBeenCalledWith(116, 36)
  })

  it('keeps DOM geometry stable when only rows scrollWidth reaches the scrollbar after resize', () => {
    const terminal = createTerminalMock()
    terminal.cols = 107
    terminal.rows = 37
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.149532710280374,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 107, rows: 37 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 790,
          xtermWidth: 790,
          screenWidth: 765,
          rowsScrollWidth: 796,
          maxRowRight: 773,
          scrollbarLeft: 780.4,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 107, rows: 37 } },
    })

    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('shrinks one more column when the current DOM screen is already inside the scrollbar gap', () => {
    const terminal = createTerminalMock()
    terminal.cols = 115
    terminal.rows = 38
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.146551724137931,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 117, rows: 38 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 859,
          xtermWidth: 859,
          screenWidth: 829,
          rowsScrollWidth: 829,
          maxRowRight: 837,
          scrollbarLeft: 841.4,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 115, rows: 38 } },
    })

    expect(size).toStrictEqual({ cols: 114, rows: 38 })
    expect(terminal.resize).toHaveBeenCalledWith(114, 38)
  })

  it('does not refresh DOM renderer geometry after overhang correction is stable', () => {
    const terminal = createTerminalMock()
    terminal.cols = 110
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.287037037037037,
      height: 15.2,
    }
    const lastCommittedPtySizeRef = { current: { cols: 110, rows: 40 } }

    const scheduler = createTerminalDomTextOverhangGeometryCommitScheduler({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 115, rows: 40 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 864,
          xtermWidth: 864,
          screenWidth: 801,
          rowsScrollWidth: 827,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      suppressPtyResizeRef: { current: false },
      sessionId: 'session-dom-overhang-stable',
    })

    scheduler.schedule()

    expect(terminal.resize).not.toHaveBeenCalled()
    expect(terminal.refresh).not.toHaveBeenCalled()
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 110, rows: 40 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('preserves scroll offset when local measured geometry resizes the xterm viewport', () => {
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
  })

  it('waits for stable measured geometry before the initial restore commit', async () => {
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
    })
  })

  it('keeps settling when the initial mounted measurement expands after early stable frames', async () => {
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
    })
  })

  it('keeps settling when applying the early geometry unlocks the final mounted measurement', async () => {
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

    expect(size).toStrictEqual({ cols: 104, rows: 41, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 104, rows: 41 })
    expect(terminal.resize).toHaveBeenCalledWith(97, 40)
    expect(terminal.resize).toHaveBeenLastCalledWith(104, 41)
    expect(ptyResize).toHaveBeenCalledTimes(1)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-initial-local-settle-expand',
      cols: 104,
      rows: 41,
      reason: 'frame_commit',
    })
  })

  it('uses the settled measured geometry for appearance commits after display metrics change', async () => {
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
    })
  })
})
