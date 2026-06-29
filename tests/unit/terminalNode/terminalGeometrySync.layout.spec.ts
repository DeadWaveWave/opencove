import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitTerminalNodeGeometry,
  fitTerminalNodeToMeasuredSize,
  refreshTerminalNodeSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import {
  cleanupTerminalGeometrySyncTestWindow,
  createDomLayoutContainerMock,
  createTerminalMock,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

describe('terminal geometry layout sync helpers', () => {
  beforeEach(() => {
    installTerminalGeometrySyncTestWindow()
  })

  afterEach(() => {
    cleanupTerminalGeometrySyncTestWindow()
  })

  it('refreshes layout without writing PTY geometry', () => {
    const terminal = createTerminalMock()

    refreshTerminalNodeSize({
      terminalRef: { current: terminal as never },
      containerRef: { current: { clientWidth: 640, clientHeight: 320 } as never },
      isPointerResizingRef: { current: false },
    })

    expect(terminal.refresh).toHaveBeenCalledWith(0, 23)
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('ignores transient detached renderer errors during refresh', () => {
    const terminal = createTerminalMock()
    terminal.refresh = vi.fn(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'dimensions')")
    })

    expect(() => {
      refreshTerminalNodeSize({
        terminalRef: { current: terminal as never },
        containerRef: { current: { clientWidth: 640, clientHeight: 320 } as never },
        isPointerResizingRef: { current: false },
      })
    }).not.toThrow()

    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('forces stale DOM renderer dimensions when the render service queues resize while paused', () => {
    const terminal = createTerminalMock()
    terminal.cols = 97
    terminal.rows = 39
    const cellWidth = 7.140625
    const cellHeight = 15.222222222222221
    terminal._core._renderService.dimensions = {
      css: {
        cell: {
          width: cellWidth,
          height: cellHeight,
        },
        canvas: {
          width: 457,
          height: 274,
        },
      },
    }
    const renderServiceHandleResize = vi.fn()
    const domRendererHandleResize = vi.fn((cols: number, rows: number) => {
      terminal._core._renderService.dimensions.css.canvas = {
        width: Math.round(cols * cellWidth),
        height: Math.round(rows * cellHeight),
      }
    })
    Object.assign(terminal._core._renderService, {
      handleResize: renderServiceHandleResize,
      _renderer: {
        value: {
          handleResize: domRendererHandleResize,
        },
      },
    })

    refreshTerminalNodeSize({
      terminalRef: { current: terminal as never },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 748,
          xtermWidth: 748,
          screenWidth: 457,
          rowsScrollWidth: 457,
        }) as never,
      },
      isPointerResizingRef: { current: false },
    })

    expect(renderServiceHandleResize).toHaveBeenCalledWith(97, 39)
    expect(domRendererHandleResize).toHaveBeenCalledWith(97, 39)
    expect(terminal._core._renderService.dimensions.css.canvas.width).toBe(693)
    expect(terminal.refresh).toHaveBeenCalledWith(0, 38)
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('clamps xterm border-box height without dropping terminal padding', () => {
    const terminal = createTerminalMock()
    ;(
      window as unknown as { getComputedStyle: (element: unknown) => CSSStyleDeclaration }
    ).getComputedStyle = () =>
      ({
        boxSizing: 'border-box',
        paddingTop: '8px',
        paddingBottom: '8px',
      }) as CSSStyleDeclaration

    refreshTerminalNodeSize({
      terminalRef: { current: terminal as never },
      containerRef: { current: { clientWidth: 640, clientHeight: 320 } as never },
      isPointerResizingRef: { current: false },
    })

    expect(terminal.element.style.height).toBe('304px')
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('commits measured geometry only on explicit commit', () => {
    const terminal = createTerminalMock()

    commitTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 96, rows: 30 })),
        } as never,
      },
      containerRef: { current: { clientWidth: 640, clientHeight: 320 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 80, rows: 24 } },
      sessionId: 'session-geometry',
      reason: 'frame_commit',
    })

    expect(terminal.resize).toHaveBeenCalledWith(96, 30)
    expect(terminal.refresh).toHaveBeenCalledWith(0, 29)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-geometry',
      cols: 96,
      rows: 30,
      reason: 'frame_commit',
    })
  })

  it('can locally fit a placeholder without writing PTY geometry', () => {
    const terminal = createTerminalMock()

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 64, rows: 44 })),
        } as never,
      },
      containerRef: { current: { clientWidth: 640, clientHeight: 660 } as never },
      isPointerResizingRef: { current: false },
    })

    expect(size).toStrictEqual({ cols: 64, rows: 44 })
    expect(terminal.resize).toHaveBeenCalledWith(64, 44)
    expect(terminal.refresh).toHaveBeenCalledWith(0, 43)
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('keeps the FitAddon right gutter instead of reclaiming it as text columns', () => {
    const terminal = createTerminalMock()
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.28,
      height: 12,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 121, rows: 40 })),
        } as never,
      },
      containerRef: { current: { clientWidth: 898, clientHeight: 624 } as never },
      isPointerResizingRef: { current: false },
    })

    expect(size).toStrictEqual({ cols: 121, rows: 40 })
    expect(terminal.resize).toHaveBeenCalledWith(121, 40)
  })

  it('shrinks DOM renderer geometry when real row content would be clipped by xterm overflow', () => {
    const terminal = createTerminalMock()
    terminal.cols = 117
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.282051282051282,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 117, rows: 40 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 865,
          xtermWidth: 865,
          screenWidth: 852,
          rowsScrollWidth: 884,
          maxRowRight: 892,
        }) as never,
      },
      isPointerResizingRef: { current: false },
    })

    expect(size).toStrictEqual({ cols: 111, rows: 40 })
    expect(terminal.resize).toHaveBeenCalledWith(111, 40)
  })

  it('does not reserve DOM renderer overhang space when rows match the measured cell width', () => {
    const terminal = createTerminalMock()
    terminal.cols = 108
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.28,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 108, rows: 40 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 813,
          xtermWidth: 813,
          screenWidth: 786,
          rowsScrollWidth: 786,
        }) as never,
      },
      isPointerResizingRef: { current: false },
    })

    expect(size).toStrictEqual({ cols: 108, rows: 40 })
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('keeps DOM renderer text close to the scrollbar when the measured gap is already safe', () => {
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

  it('keeps the DOM renderer scrollbar gap decision in unscaled CSS pixels', () => {
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
          rowsScrollWidth: 765,
          maxRowRight: 773,
          scrollbarLeft: 780.4,
          scaleX: 0.7,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 107, rows: 37 } },
    })

    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('uses visible DOM row overflow when keeping text away from the scrollbar', () => {
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
          maxRowRight: 851,
          maxSpanRight: 851,
          scrollbarLeft: 852,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 117, rows: 36 } },
    })

    expect(size).toStrictEqual({ cols: 116, rows: 36 })
    expect(terminal.resize).toHaveBeenCalledWith(116, 36)
  })

  it('keeps DOM renderer geometry capped after a previous overhang correction', () => {
    const terminal = createTerminalMock()
    terminal.cols = 114
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.282051282051282,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 117, rows: 40 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 865,
          xtermWidth: 865,
          screenWidth: 830,
          rowsScrollWidth: 861,
          maxRowRight: 869,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 114, rows: 40 } },
    })

    expect(size).toStrictEqual({ cols: 111, rows: 40 })
    expect(terminal.resize).toHaveBeenCalledWith(111, 40)
  })
})
