import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
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

describe('terminal geometry DOM overhang helpers', () => {
  beforeEach(() => {
    installTerminalGeometrySyncTestWindow()
  })

  afterEach(() => {
    cleanupTerminalGeometrySyncTestWindow()
  })

  it('commits a smaller DOM renderer geometry after text output exposes clipped content', () => {
    const terminal = createTerminalMock()
    terminal.cols = 117
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.282051282051282,
      height: 15.2,
    }
    const lastCommittedPtySizeRef = { current: { cols: 117, rows: 40 } }

    const scheduler = createTerminalDomTextOverhangGeometryCommitScheduler({
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
      lastCommittedPtySizeRef,
      suppressPtyResizeRef: { current: false },
      sessionId: 'session-dom-overhang',
    })

    scheduler.schedule()

    expect(terminal.resize).toHaveBeenCalledWith(111, 40)
    expect(terminal.refresh).toHaveBeenCalledWith(0, 39)
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 117, rows: 40 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('does not cascade DOM overhang correction across repeated output frames', () => {
    const animationFrames: FrameRequestCallback[] = []
    ;(window as unknown as typeof window).requestAnimationFrame = vi.fn(
      (callback: FrameRequestCallback) => {
        animationFrames.push(callback)
        return animationFrames.length
      },
    )
    const flushAnimationFrames = (): void => {
      while (animationFrames.length > 0) {
        animationFrames.shift()?.(0)
      }
    }
    const terminal = createTerminalMock()
    terminal.cols = 117
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.282051282051282,
      height: 15.2,
    }
    const lastCommittedPtySizeRef = { current: { cols: 117, rows: 40 } }

    const scheduler = createTerminalDomTextOverhangGeometryCommitScheduler({
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
      lastCommittedPtySizeRef,
      suppressPtyResizeRef: { current: false },
      sessionId: 'session-dom-overhang-repeat',
    })

    scheduler.schedule()
    flushAnimationFrames()
    scheduler.schedule()
    flushAnimationFrames()

    expect(terminal.resize).toHaveBeenCalledTimes(1)
    expect(terminal.resize).toHaveBeenCalledWith(111, 40)
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 117, rows: 40 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('keeps DOM overhang correction local without mutating committed PTY geometry', () => {
    const animationFrames: FrameRequestCallback[] = []
    ;(window as unknown as typeof window).requestAnimationFrame = vi.fn(
      (callback: FrameRequestCallback) => {
        animationFrames.push(callback)
        return animationFrames.length
      },
    )
    const flushAnimationFrames = (): void => {
      while (animationFrames.length > 0) {
        animationFrames.shift()?.(0)
      }
    }
    const terminal = createTerminalMock()
    terminal.cols = 92
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.142857142857143,
      height: 15.2,
    }
    const lastCommittedPtySizeRef = { current: { cols: 92, rows: 40 } }
    const containerRef = {
      current: createDomLayoutContainerMock({
        containerWidth: 722,
        xtermWidth: 722,
        screenWidth: 658,
        rowsScrollWidth: 690,
        maxRowRight: 698,
      }) as HTMLElement,
    }

    const scheduler = createTerminalDomTextOverhangGeometryCommitScheduler({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 97, rows: 40 })),
        } as never,
      },
      containerRef: containerRef as never,
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      suppressPtyResizeRef: { current: false },
      sessionId: 'session-dom-overhang-recover',
    })

    scheduler.schedule()
    flushAnimationFrames()

    expect(terminal.resize).toHaveBeenCalledWith(91, 40)
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 92, rows: 40 })

    containerRef.current = createDomLayoutContainerMock({
      containerWidth: 722,
      xtermWidth: 722,
      screenWidth: 650,
      rowsScrollWidth: 662,
      maxRowRight: 670.45,
      scrollbarLeft: 704.4,
    })
    scheduler.schedule()
    flushAnimationFrames()

    expect(terminal.resize).toHaveBeenLastCalledWith(92, 40)
    expect(terminal.resize).toHaveBeenCalledTimes(2)
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 92, rows: 40 })

    scheduler.schedule()
    flushAnimationFrames()

    expect(terminal.resize).toHaveBeenCalledTimes(2)
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 92, rows: 40 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('restores restart-local geometry drift when DOM space fits committed PTY geometry', () => {
    const terminal = createTerminalMock()
    terminal.cols = 91
    terminal.rows = 39
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.142857142857143,
      height: 15.2,
    }
    const lastCommittedPtySizeRef = { current: { cols: 92, rows: 40 } }

    const scheduler = createTerminalDomTextOverhangGeometryCommitScheduler({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 92, rows: 40 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 722,
          xtermWidth: 722,
          screenWidth: 650,
          rowsScrollWidth: 650,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      suppressPtyResizeRef: { current: false },
      sessionId: 'session-dom-overhang-restart-drift',
    })

    scheduler.schedule()

    expect(terminal.resize).toHaveBeenCalledWith(92, 40)
    expect(terminal.refresh).toHaveBeenCalledWith(0, 39)
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 92, rows: 40 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('commits a smaller DOM renderer geometry when glyph overhang reaches the scrollbar', () => {
    const terminal = createTerminalMock()
    terminal.cols = 107
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.280373831775701,
      height: 15.2,
    }
    const lastCommittedPtySizeRef = { current: { cols: 107, rows: 40 } }

    const scheduler = createTerminalDomTextOverhangGeometryCommitScheduler({
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
          screenWidth: 779,
          rowsScrollWidth: 811,
          maxRowRight: 819,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      suppressPtyResizeRef: { current: false },
      sessionId: 'session-dom-scrollbar-overhang',
    })

    scheduler.schedule()

    expect(terminal.resize).toHaveBeenCalledWith(102, 40)
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 107, rows: 40 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('ignores output-time DOM renderer measurements when rows already fit before the scrollbar', () => {
    const terminal = createTerminalMock()
    terminal.cols = 103
    terminal.rows = 46
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.15,
      height: 15.2,
    }
    const lastCommittedPtySizeRef = { current: { cols: 103, rows: 46 } }

    const scheduler = createTerminalDomTextOverhangGeometryCommitScheduler({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 104, rows: 46 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 780,
          xtermWidth: 780,
          screenWidth: 736.45,
          rowsScrollWidth: 736.45,
          maxRowRight: 744.45,
          scrollbarLeft: 764.45,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      suppressPtyResizeRef: { current: false },
      sessionId: 'session-dom-no-overhang',
    })

    scheduler.schedule()

    expect(terminal.resize).not.toHaveBeenCalled()
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 103, rows: 46 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('does not use output-time DOM checks as a plain fit commit without overhang', () => {
    const terminal = createTerminalMock()
    terminal.cols = 103
    terminal.rows = 46
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.15,
      height: 15.2,
    }
    const lastCommittedPtySizeRef = { current: { cols: 103, rows: 46 } }

    const scheduler = createTerminalDomTextOverhangGeometryCommitScheduler({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 102, rows: 46 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 780,
          xtermWidth: 780,
          screenWidth: 729.3,
          rowsScrollWidth: 729.3,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      suppressPtyResizeRef: { current: false },
      sessionId: 'session-dom-plain-fit-shrink',
    })

    scheduler.schedule()

    expect(terminal.resize).not.toHaveBeenCalled()
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 103, rows: 46 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('moves DOM renderer text back toward the scrollbar when the safety gap was too wide', () => {
    const terminal = createTerminalMock()
    terminal.cols = 108
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.287037037037037,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
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
          screenWidth: 787,
          rowsScrollWidth: 812,
          maxRowRight: 820,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 108, rows: 40 } },
    })

    expect(size).toStrictEqual({ cols: 110, rows: 40 })
    expect(terminal.resize).toHaveBeenCalledWith(110, 40)
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

  it('ignores DOM scrollWidth noise when visible rows are not clipped', () => {
    const terminal = createTerminalMock()
    terminal.cols = 105
    terminal.rows = 36
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.285714285714286,
      height: 15.2,
    }

    const size = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 110, rows: 36 })),
        } as never,
      },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 832,
          xtermWidth: 832,
          screenWidth: 765,
          rowsScrollWidth: 791,
          maxRowRight: 773,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 105, rows: 36 } },
    })

    expect(size).toStrictEqual({ cols: 110, rows: 36 })
    expect(terminal.resize).toHaveBeenCalledWith(110, 36)
  })
})
