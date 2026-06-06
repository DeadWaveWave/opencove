import { describe, expect, it, vi } from 'vitest'
import { fitTerminalNodeToMeasuredSize } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import {
  createDomLayoutContainerMock,
  createTerminalMock,
  installTerminalGeometrySyncWindowMock,
} from './terminalGeometrySync.testUtils'

describe('terminal DOM renderer scrollbar geometry', () => {
  installTerminalGeometrySyncWindowMock()

  it('does not convert DOM renderer screen-to-scrollbar gap into PTY columns', () => {
    const terminal = createTerminalMock()
    terminal.cols = 112 // Already at reduced cols for DOM renderer
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
      lastCommittedPtySizeRef: { current: { cols: 112, rows: 36 } }, // Already at reduced cols
    })

    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('does not convert DOM renderer glyph overhang into PTY columns', () => {
    const terminal = createTerminalMock()
    terminal.cols = 112 // Already at reduced cols for DOM renderer
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
      lastCommittedPtySizeRef: { current: { cols: 112, rows: 36 } }, // Already at reduced cols
    })

    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('recovers FitAddon capacity after a previous DOM glyph correction', () => {
    const terminal = createTerminalMock()
    terminal.cols = 115
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
          screenWidth: 822,
          rowsScrollWidth: 822,
          maxRowRight: 826,
          maxSpanRight: 830,
          scrollbarLeft: 844.3,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 115, rows: 36 } },
    })

    // DOM renderer reduces cols by 5 to prevent text overflow with CJK characters
    expect(size).toStrictEqual({ cols: 112, rows: 36 })
    expect(terminal.resize).toHaveBeenCalledWith(112, 36)
  })

  it('does not remove PTY columns for a DOM renderer scrollbar gap', () => {
    const terminal = createTerminalMock()
    terminal.cols = 112 // Already at reduced cols for DOM renderer
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
      lastCommittedPtySizeRef: { current: { cols: 112, rows: 36 } }, // Already at reduced cols
    })

    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('keeps DOM geometry stable when only rows scrollWidth reaches the scrollbar after resize', () => {
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
          rowsScrollWidth: 796,
          maxRowRight: 773,
          scrollbarLeft: 780.4,
        }) as never,
      },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: { cols: 102, rows: 37 } }, // Already at reduced cols
    })

    expect(size).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
  })

  it('does not shrink PTY columns when the DOM screen is inside the scrollbar gap', () => {
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

    // DOM renderer reduces cols by 5 to prevent text overflow with CJK characters
    expect(size).toStrictEqual({ cols: 112, rows: 38 })
    expect(terminal.resize).toHaveBeenCalledWith(112, 38)
  })
})
