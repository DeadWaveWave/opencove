import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitTerminalNodeGeometry,
  fitTerminalNodeToMeasuredSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import {
  cleanupTerminalGeometrySyncTestWindow,
  createDomLayoutContainerMock,
  createTerminalMock,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

describe('terminal geometry content independence', () => {
  beforeEach(() => {
    installTerminalGeometrySyncTestWindow()
  })

  afterEach(() => {
    cleanupTerminalGeometrySyncTestWindow()
  })

  it('keeps measured geometry stable when output changes the DOM text footprint', () => {
    const terminal = createTerminalMock()
    terminal.cols = 117
    terminal.rows = 40
    terminal._core._renderService.dimensions.css.cell = {
      width: 7.282051282051282,
      height: 15.2,
    }
    const lastCommittedPtySizeRef = { current: { cols: 117, rows: 40 } }
    const containerRef = {
      current: createDomLayoutContainerMock({
        containerWidth: 865,
        xtermWidth: 865,
        screenWidth: 852,
        rowsScrollWidth: 884,
        maxRowRight: 892,
      }) as HTMLElement,
    }
    const fitAddonRef = {
      current: {
        proposeDimensions: vi.fn(() => ({ cols: 117, rows: 40 })),
      } as never,
    }

    const overhangingResult = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef,
      containerRef: containerRef as never,
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
    })

    containerRef.current = createDomLayoutContainerMock({
      containerWidth: 865,
      xtermWidth: 865,
      screenWidth: 852,
      rowsScrollWidth: 852,
      maxRowRight: 860,
    })
    const shortOutputResult = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef,
      containerRef: containerRef as never,
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
    })

    expect(overhangingResult).toBeNull()
    expect(shortOutputResult).toBeNull()
    expect(fitAddonRef.current.proposeDimensions).toHaveBeenCalledTimes(2)
    expect(terminal.resize).not.toHaveBeenCalled()
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 117, rows: 40 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('does not toggle local columns when only the visible scrollbar footprint changes', () => {
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
        screenWidth: 650,
        rowsScrollWidth: 650,
        maxRowRight: 658,
        scrollbarLeft: 662.4,
      }) as HTMLElement,
    }
    const fitAddonRef = {
      current: {
        proposeDimensions: vi.fn(() => ({ cols: 92, rows: 40 })),
      } as never,
    }

    const nearScrollbarResult = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef,
      containerRef: containerRef as never,
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
    })

    containerRef.current = createDomLayoutContainerMock({
      containerWidth: 722,
      xtermWidth: 722,
      screenWidth: 650,
      rowsScrollWidth: 650,
      maxRowRight: 658,
      scrollbarLeft: 670.4,
    })
    const wideGapResult = fitTerminalNodeToMeasuredSize({
      terminalRef: { current: terminal as never },
      fitAddonRef,
      containerRef: containerRef as never,
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
    })

    expect(nearScrollbarResult).toBeNull()
    expect(wideGapResult).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 92, rows: 40 })
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('applies a real layout change only through the canonical geometry acknowledgement', async () => {
    const terminal = createTerminalMock()
    terminal.cols = 92
    terminal.rows = 40
    const lastCommittedPtySizeRef = { current: { cols: 92, rows: 40 } }

    const result = await commitTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 96, rows: 42 })),
        } as never,
      },
      containerRef: { current: { clientWidth: 760, clientHeight: 640 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-real-layout-change',
      reason: 'frame_commit',
    })

    expect(result).toBeUndefined()
    expect(ptyResize).toHaveBeenCalledTimes(1)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-real-layout-change',
      cols: 96,
      rows: 42,
      reason: 'frame_commit',
      operationId: expect.any(String),
      baseGeometryRevision: null,
      authorityEpoch: null,
    })
    expect(terminal.resize).toHaveBeenCalledTimes(1)
    expect(terminal.resize).toHaveBeenCalledWith(96, 42)
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 96, rows: 42 })
  })
})
