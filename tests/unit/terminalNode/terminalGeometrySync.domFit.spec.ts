import { describe, expect, it, vi } from 'vitest'
import { fitTerminalNodeToMeasuredSize } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import {
  createDomLayoutContainerMock,
  createTerminalMock,
  installTerminalGeometrySyncWindowMock,
} from './terminalGeometrySync.testUtils'
describe('terminal DOM renderer fit geometry', () => {
  installTerminalGeometrySyncWindowMock()
  it('keeps FitAddon capacity when DOM renderer row footprint overhangs', () => {
    const terminal = createTerminalMock()
    terminal.cols = 112 // 117 - 5 for DOM renderer
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

    // DOM renderer reduces cols by 5 to prevent text overflow with CJK characters
    expect(size).toStrictEqual({ cols: 112, rows: 40 })
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('does not reserve DOM renderer overhang space when rows match the measured cell width', () => {
    const terminal = createTerminalMock()
    terminal.cols = 103
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

    // DOM renderer reduces cols by 5 to prevent text overflow with CJK characters
    expect(size).toStrictEqual({ cols: 103, rows: 40 })
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('keeps DOM renderer text close to the scrollbar when the measured gap is already safe', () => {
    const terminal = createTerminalMock()
    terminal.cols = 102 // Already at reduced cols for DOM renderer (107 - 5)
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
      lastCommittedPtySizeRef: { current: { cols: 102, rows: 37 } }, // Already at reduced cols
    })

    // Should return null because terminal is already at the reduced cols
    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('keeps the DOM renderer scrollbar gap decision in unscaled CSS pixels', () => {
    const terminal = createTerminalMock()
    terminal.cols = 102 // Already at reduced cols for DOM renderer
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
      lastCommittedPtySizeRef: { current: { cols: 102, rows: 37 } }, // Already at reduced cols
    })

    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('does not convert visible DOM row overflow into PTY columns', () => {
    const terminal = createTerminalMock()
    terminal.cols = 112 // Already at reduced cols for DOM renderer (117 - 5)
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
      lastCommittedPtySizeRef: { current: { cols: 112, rows: 36 } }, // Already at reduced cols
    })

    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('recovers FitAddon capacity after a previous DOM renderer overhang correction', () => {
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

    // DOM renderer reduces cols by 5 to prevent text overflow with CJK characters
    expect(size).toStrictEqual({ cols: 112, rows: 40 })
    expect(terminal.resize).toHaveBeenCalledWith(112, 40)
  })

  it('uses FitAddon capacity when committed geometry can expand', () => {
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

    // DOM renderer reduces cols by 5 to prevent text overflow with CJK characters
    expect(size).toStrictEqual({ cols: 110, rows: 40 })
    expect(terminal.resize).toHaveBeenCalledWith(110, 40)
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

    // DOM renderer reduces cols by 5 to prevent text overflow with CJK characters
    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })
})
