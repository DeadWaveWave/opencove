import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshTerminalNodeSize } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'

function createTerminalMock() {
  const terminal = {
    cols: 117,
    rows: 40,
    element: {
      style: {},
    },
    buffer: {
      active: {
        baseY: 120,
        viewportY: 90,
      },
    },
    scrollToLine: vi.fn((line: number) => {
      terminal.buffer.active.viewportY = line
    }),
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
              width: 7.286885245901639,
              height: 15.2,
            },
            canvas: {
              width: 889,
              height: 608,
            },
          },
        },
        _renderer: {
          value: {
            handleResize: vi.fn(),
          },
        },
      },
      _bufferService: {
        isUserScrolling: true,
        buffer: {
          ydisp: 90,
        },
      },
      _viewport: {
        queueSync: vi.fn((ydisp?: number) => {
          if (typeof ydisp === 'number') {
            terminal.buffer.active.viewportY = ydisp
          }
        }),
        scrollToLine: vi.fn((line: number) => {
          terminal.buffer.active.viewportY = line
        }),
      },
    },
  }

  return terminal
}

function createDomLayoutContainerMock({
  containerWidth,
  xtermWidth,
  screenWidth,
  rowsScrollWidth,
  maxRowRight,
}: {
  containerWidth: number
  xtermWidth: number
  screenWidth: number
  rowsScrollWidth: number
  maxRowRight?: number
}) {
  const container = document.createElement('div')
  container.dataset.coveTerminalRenderer = 'dom'
  const xterm = document.createElement('div')
  xterm.className = 'xterm'
  const viewport = document.createElement('div')
  viewport.className = 'xterm-viewport'
  const screen = document.createElement('div')
  screen.className = 'xterm-screen'
  const rows = document.createElement('div')
  rows.className = 'xterm-rows'
  const row = document.createElement('div')
  rows.append(row)
  screen.append(rows)
  xterm.append(viewport, screen)
  container.append(xterm)

  Object.defineProperty(container, 'clientWidth', { value: containerWidth, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: 624, configurable: true })
  Object.defineProperty(xterm, 'clientWidth', { value: xtermWidth, configurable: true })
  Object.defineProperty(screen, 'clientWidth', { value: screenWidth, configurable: true })
  Object.defineProperty(screen, 'scrollWidth', { value: rowsScrollWidth, configurable: true })
  Object.defineProperty(rows, 'scrollWidth', { value: rowsScrollWidth, configurable: true })
  screen.getBoundingClientRect = () =>
    ({
      left: 8,
      right: 8 + screenWidth,
      width: screenWidth,
      top: 0,
      bottom: 624,
      height: 624,
      x: 8,
      y: 0,
      toJSON: () => undefined,
    }) as DOMRect
  row.getBoundingClientRect = () =>
    ({
      left: 8,
      right: maxRowRight ?? 8 + rowsScrollWidth,
      width: (maxRowRight ?? 8 + rowsScrollWidth) - 8,
      top: 0,
      bottom: 15,
      height: 15,
      x: 8,
      y: 0,
      toJSON: () => undefined,
    }) as DOMRect

  return container
}

describe('DOM renderer terminal geometry sync', () => {
  const ptyResize = vi.fn()

  beforeEach(() => {
    ptyResize.mockReset()
    vi.stubGlobal('window', {
      ...window,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
      cancelAnimationFrame: vi.fn(),
      setTimeout: (callback: () => void) => {
        callback()
        return 1
      },
      opencoveApi: {
        pty: {
          resize: ptyResize,
        },
        meta: {
          enableTerminalDiagnostics: false,
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forces stale DOM renderer dimensions to the current terminal geometry before refresh', () => {
    const terminal = createTerminalMock()

    refreshTerminalNodeSize({
      terminalRef: { current: terminal as never },
      containerRef: {
        current: createDomLayoutContainerMock({
          containerWidth: 865,
          xtermWidth: 865,
          screenWidth: 889,
          rowsScrollWidth: 889,
        }) as never,
      },
      isPointerResizingRef: { current: false },
    })

    expect(terminal._core._renderService._renderer.value.handleResize).toHaveBeenCalledWith(117, 40)
    expect(terminal.resize).not.toHaveBeenCalled()
    expect(terminal.refresh).toHaveBeenCalledWith(0, 39)
    expect(ptyResize).not.toHaveBeenCalled()
  })
})
