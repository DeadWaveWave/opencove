import { vi } from 'vitest'

export function createTerminalMock() {
  const terminal = {
    cols: 80,
    rows: 24,
    element: {
      style: {},
    },
    buffer: {
      active: {
        baseY: 0,
        viewportY: 0,
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
              height: 12,
            },
          },
        },
      },
      _bufferService: {
        isUserScrolling: false,
        buffer: {
          ydisp: 0,
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

export function createDomLayoutContainerMock({
  containerWidth,
  xtermWidth,
  screenWidth,
  rowsScrollWidth,
  maxRowRight,
  maxSpanRight,
  scrollbarLeft,
  scrollbarWidth = 10,
  scaleX = 1,
}: {
  containerWidth: number
  xtermWidth: number
  screenWidth: number
  rowsScrollWidth: number
  maxRowRight?: number
  maxSpanRight?: number
  scrollbarLeft?: number
  scrollbarWidth?: number
  scaleX?: number
}) {
  const scaleRectX = (value: number): number => 8 + (value - 8) * scaleX
  const scaleRectWidth = (value: number): number => value * scaleX
  const container = document.createElement('div')
  container.dataset.coveTerminalRenderer = 'dom'
  const xterm = document.createElement('div')
  xterm.className = 'xterm'
  const screen = document.createElement('div')
  screen.className = 'xterm-screen'
  const rows = document.createElement('div')
  rows.className = 'xterm-rows'
  const row = document.createElement('div')
  const span = document.createElement('span')
  row.append(span)
  rows.append(row)
  screen.append(rows)
  if (typeof scrollbarLeft === 'number') {
    const scrollable = document.createElement('div')
    scrollable.className = 'xterm-scrollable-element'
    const scrollbar = document.createElement('div')
    scrollbar.className = 'scrollbar vertical'
    scrollable.append(scrollbar)
    xterm.append(scrollable)
    scrollbar.getBoundingClientRect = () =>
      ({
        left: scaleRectX(scrollbarLeft),
        right: scaleRectX(scrollbarLeft + scrollbarWidth),
        width: scaleRectWidth(scrollbarWidth),
        top: 8,
        bottom: 616,
        height: 608,
        x: scaleRectX(scrollbarLeft),
        y: 8,
        toJSON: () => undefined,
      }) as DOMRect
  }
  xterm.append(screen)
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
      right: 8 + scaleRectWidth(screenWidth),
      width: scaleRectWidth(screenWidth),
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
      right: scaleRectX(maxRowRight ?? 8 + rowsScrollWidth),
      width: scaleRectX(maxRowRight ?? 8 + rowsScrollWidth) - 8,
      top: 0,
      bottom: 15,
      height: 15,
      x: 8,
      y: 0,
      toJSON: () => undefined,
    }) as DOMRect
  span.getBoundingClientRect = () =>
    ({
      left: 8,
      right: scaleRectX(maxSpanRight ?? maxRowRight ?? 8 + rowsScrollWidth),
      width: scaleRectX(maxSpanRight ?? maxRowRight ?? 8 + rowsScrollWidth) - 8,
      top: 0,
      bottom: 15,
      height: 15,
      x: 8,
      y: 0,
      toJSON: () => undefined,
    }) as DOMRect
  return container
}

export const ptyResize = vi.fn()

export function installTerminalGeometrySyncTestWindow(): void {
  ptyResize.mockReset()
  vi.stubGlobal('window', {
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
    },
  })
}

export function cleanupTerminalGeometrySyncTestWindow(): void {
  vi.unstubAllGlobals()
}
