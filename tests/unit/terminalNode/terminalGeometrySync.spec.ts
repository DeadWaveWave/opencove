import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitInitialTerminalNodeGeometry,
  commitTerminalNodeGeometry,
  fitTerminalNodeToMeasuredSize,
  refreshTerminalNodeSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import { createRuntimeInitialGeometryCommitter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.initialGeometry'

function createTerminalMock() {
  const terminal = {
    cols: 80,
    rows: 24,
    element: {
      style: {},
    },
    refresh: vi.fn(),
    resize: vi.fn((cols: number, rows: number) => {
      terminal.cols = cols
      terminal.rows = rows
    }),
    _core: {
      _renderService: {
        dimensions: {
          css: {
            cell: {
              height: 12,
            },
          },
        },
      },
    },
  }

  return terminal
}

describe('terminal geometry sync helpers', () => {
  const ptyResize = vi.fn()

  beforeEach(() => {
    ptyResize.mockReset()
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
      setTimeout: (callback: () => void) => {
        callback()
        return 1
      },
      opencoveApi: {
        pty: {
          resize: ptyResize,
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('does not write PTY geometry when the initial restore size is already canonical', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: { cols: 64, rows: 44 },
    }

    const size = await commitInitialTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 64, rows: 44 })),
        } as never,
      },
      containerRef: { current: { clientWidth: 640, clientHeight: 660 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-initial-geometry',
      reason: 'frame_commit',
    })

    expect(size).toStrictEqual({ cols: 64, rows: 44, changed: false })
    expect(terminal.resize).toHaveBeenCalledWith(64, 44)
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('commits measured runtime geometry when the durable seed no longer matches layout', async () => {
    const terminal = createTerminalMock()
    const fitAddon = {
      proposeDimensions: vi.fn(() => ({ cols: 65, rows: 44 })),
    }
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }
    const commitInitialGeometry = createRuntimeInitialGeometryCommitter({
      terminalRef: { current: terminal as never },
      fitAddonRef: { current: fitAddon as never },
      containerRef: { current: { clientWidth: 640, clientHeight: 660 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-runtime-restore',
      canonicalInitialGeometry: { cols: 64, rows: 44 },
      allowMeasuredResizeCommit: true,
    })

    const size = await commitInitialGeometry(null)

    expect(size).toStrictEqual({ cols: 65, rows: 44, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 65, rows: 44 })
    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(terminal.resize).toHaveBeenCalledWith(65, 44)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-runtime-restore',
      cols: 65,
      rows: 44,
      reason: 'frame_commit',
    })
  })
})
