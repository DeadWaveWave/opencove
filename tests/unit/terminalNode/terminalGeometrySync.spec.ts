import { describe, expect, it, vi } from 'vitest'
import {
  commitTerminalNodeGeometry,
  fitTerminalNodeToMeasuredSize,
  refreshTerminalNodeSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import {
  createDomLayoutContainerMock,
  createTerminalMock,
  installTerminalGeometrySyncWindowMock,
} from './terminalGeometrySync.testUtils'
describe('terminal geometry sync helpers', () => {
  const { ptyResize } = installTerminalGeometrySyncWindowMock()
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

  it('clamps xterm root height from rows and cell height during refresh', () => {
    const terminal = createTerminalMock()
    ;(
      window as unknown as { getComputedStyle: (element: unknown) => CSSStyleDeclaration }
    ).getComputedStyle = () =>
      ({
        boxSizing: 'border-box',
        paddingTop: '8px',
        paddingBottom: '8px',
      }) as CSSStyleDeclaration
    terminal.element.style.height = '100%'
    terminal.rows = 20
    terminal._core._renderService.dimensions.css.cell = {
      width: 7,
      height: 15.25,
    }
    Object.assign(terminal._core._renderService.dimensions.css, {
      canvas: {
        width: 640,
        height: 999,
      },
    })

    refreshTerminalNodeSize({
      terminalRef: { current: terminal as never },
      containerRef: { current: { clientWidth: 640, clientHeight: 320 } as never },
      isPointerResizingRef: { current: false },
    })

    expect(terminal.element.style.height).toBe('321px')
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

  it('restores local terminal geometry when measured size already matches committed PTY geometry', () => {
    const terminal = createTerminalMock()
    terminal.cols = 111
    terminal.rows = 40

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 117, rows: 40 })),
        } as never,
      },
      containerRef: { current: { clientWidth: 864, clientHeight: 624 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 117, rows: 40 } },
    })

    expect(size).toBeNull()
    expect(terminal.resize).toHaveBeenCalledWith(117, 40)
    expect(terminal.refresh).toHaveBeenCalledWith(0, 39)
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
})
