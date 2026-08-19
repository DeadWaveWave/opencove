import { describe, expect, it, vi } from 'vitest'
import {
  captureTerminalDiagnosticsSnapshot,
  captureTerminalInteractionDetails,
  captureTerminalLayoutDiagnostics,
  resolveTerminalBufferKind,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/diagnostics'
import { registerTerminalDiagnostics } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/registerDiagnostics'

describe('terminal diagnostics helpers', () => {
  it('emits resize breadcrumbs when verbose terminal diagnostics are disabled', () => {
    const emit = vi.fn()
    let onResize: ((size: { cols: number; rows: number }) => void) | null = null
    const diagnostics = registerTerminalDiagnostics({
      enabled: false,
      emit,
      nodeId: 'node-1',
      sessionId: 'session-1',
      nodeKind: 'terminal',
      title: 'Terminal',
      terminal: {
        cols: 80,
        rows: 24,
        buffer: { active: { baseY: 0, viewportY: 0, length: 24 } },
        onResize: listener => {
          onResize = listener
          return { dispose: () => undefined }
        },
      } as never,
      container: null,
      rendererKind: 'dom',
      terminalThemeMode: 'dark',
      windowsPty: null,
    })

    emit.mockClear()
    expect(onResize).not.toBeNull()
    ;(onResize as (size: { cols: number; rows: number }) => void)({ cols: 100, rows: 24 })

    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ event: 'resize' }))
    diagnostics.dispose()
  })

  it('detects the alternate buffer when active matches alternate', () => {
    const normal = { baseY: 12, viewportY: 8, length: 120 }
    const alternate = { baseY: 0, viewportY: 0, length: 24 }

    expect(
      resolveTerminalBufferKind({
        buffer: {
          active: alternate,
          normal,
          alternate,
        },
      }),
    ).toBe('alternate')
  })

  it('captures viewport and scrollbar facts from the DOM', () => {
    const terminalElement = document.createElement('div')
    const scrollable = document.createElement('div')
    scrollable.className = 'xterm-scrollable-element'
    const scrollbar = document.createElement('div')
    scrollbar.className = 'scrollbar vertical'
    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'

    Object.defineProperty(viewport, 'scrollTop', { value: 64, configurable: true })
    Object.defineProperty(viewport, 'scrollHeight', { value: 480, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 160, configurable: true })

    scrollable.append(scrollbar, viewport)
    terminalElement.append(scrollable)

    const snapshot = captureTerminalDiagnosticsSnapshot(
      {
        cols: 120,
        rows: 40,
        buffer: {
          active: { baseY: 32, viewportY: 20, length: 200 },
          normal: { baseY: 32, viewportY: 20, length: 200 },
          alternate: { baseY: 0, viewportY: 0, length: 40 },
        },
      },
      viewport,
    )

    expect(snapshot).toMatchObject({
      bufferKind: 'unknown',
      activeBaseY: 32,
      activeViewportY: 20,
      activeLength: 200,
      cols: 120,
      rows: 40,
      viewportScrollTop: 64,
      viewportScrollHeight: 480,
      viewportClientHeight: 160,
      hasViewport: true,
      hasVerticalScrollbar: true,
    })
  })

  it('captures right-side screen and row overflow diagnostics', () => {
    const terminalBody = document.createElement('div')
    terminalBody.className = 'terminal-node__terminal'
    const xterm = document.createElement('div')
    xterm.className = 'xterm'
    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    const rows = document.createElement('div')
    rows.className = 'xterm-rows'
    const row = document.createElement('div')
    const span = document.createElement('span')
    span.textContent = '测试'
    row.append(span)
    rows.append(row)
    screen.append(rows)
    xterm.append(viewport, screen)
    terminalBody.append(xterm)

    const defineRect = (element: Element, rect: Partial<DOMRectReadOnly>): void => {
      Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () =>
          ({
            left: rect.left ?? 0,
            right: rect.right ?? rect.width ?? 0,
            top: 0,
            bottom: rect.height ?? 0,
            width: rect.width ?? 0,
            height: rect.height ?? 0,
            x: rect.left ?? 0,
            y: 0,
            toJSON: () => undefined,
          }) as DOMRect,
      })
    }

    defineRect(terminalBody, { left: 10, right: 610, width: 600, height: 400 })
    defineRect(xterm, { left: 10, right: 610, width: 600, height: 400 })
    defineRect(viewport, { left: 10, right: 610, width: 600, height: 400 })
    defineRect(screen, { left: 18, right: 590, width: 572, height: 360 })
    defineRect(rows, { left: 18, right: 606, width: 588, height: 360 })
    defineRect(row, { left: 18, right: 606, width: 588, height: 15 })
    defineRect(span, { left: 18, right: 38, width: 20, height: 15 })

    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    window.getComputedStyle = ((element: Element) => {
      const style =
        element === xterm
          ? {
              'padding-left': '8px',
              'padding-right': '0px',
            }
          : element === row
            ? {
                'overflow-x': 'visible',
                'overflow-y': 'visible',
              }
            : {}

      return {
        getPropertyValue: (propertyName: string) => style[propertyName as keyof typeof style] ?? '',
        cursor: 'text',
        borderColor: 'transparent',
      } as CSSStyleDeclaration
    }) as typeof window.getComputedStyle

    try {
      Object.defineProperty(xterm, 'clientWidth', { value: 600, configurable: true })
      Object.defineProperty(screen, 'clientWidth', { value: 572, configurable: true })

      const details = captureTerminalLayoutDiagnostics({
        terminal: {
          cols: 80,
          rows: 24,
          options: {
            fontSize: 13,
            lineHeight: 1,
            letterSpacing: 0,
            fontFamily: 'Consolas',
          },
        },
        container: terminalBody,
      })

      expect(details).toMatchObject({
        containerRectRight: 610,
        screenRectRight: 590,
        rowsRectRight: 606,
        terminalVisibleWidthGapX: 28,
        terminalRightGutterPx: 20,
        xtermPaddingLeft: 8,
        xtermPaddingRight: 0,
        xtermLayoutGutterPx: 20,
        screenRowsOverflowX: 16,
        firstRowOverflowX: 'visible',
        firstRowOverflowY: 'visible',
        maxSpanWidth: 20,
      })
    } finally {
      window.getComputedStyle = originalGetComputedStyle
    }
  })

  it('captures DOM renderer right gaps in unscaled xterm CSS pixels', () => {
    const terminalBody = document.createElement('div')
    terminalBody.className = 'terminal-node__terminal'
    const xterm = document.createElement('div')
    xterm.className = 'xterm'
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    const rows = document.createElement('div')
    rows.className = 'xterm-rows'
    const row = document.createElement('div')
    const span = document.createElement('span')
    const scrollable = document.createElement('div')
    scrollable.className = 'xterm-scrollable-element'
    const scrollbar = document.createElement('div')
    scrollbar.className = 'scrollbar vertical'

    row.append(span)
    rows.append(row)
    screen.append(rows)
    scrollable.append(scrollbar)
    xterm.append(screen, scrollable)
    terminalBody.append(xterm)

    const scale = 0.7
    const scaleX = (value: number): number => 18 + (value - 18) * scale
    const defineRect = (element: Element, left: number, right: number): void => {
      Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () =>
          ({
            left: scaleX(left),
            right: scaleX(right),
            top: 0,
            bottom: 320,
            width: (right - left) * scale,
            height: 320,
            x: scaleX(left),
            y: 0,
            toJSON: () => undefined,
          }) as DOMRect,
      })
    }

    Object.defineProperty(screen, 'clientWidth', { value: 572, configurable: true })
    defineRect(screen, 18, 590)
    defineRect(rows, 18, 606)
    defineRect(row, 18, 606)
    defineRect(span, 18, 606)
    defineRect(scrollbar, 618, 628)

    const details = captureTerminalLayoutDiagnostics({
      terminal: { cols: 80, rows: 24 },
      container: terminalBody,
    })

    expect(details).toMatchObject({
      screenRectScaleX: 0.7,
      screenToScrollbarGapLocalPx: 28,
      rowContentOverflowRightLocalPx: 16,
      spanContentOverflowRightLocalPx: 16,
      visibleTextOverflowRightLocalPx: 16,
      textToScrollbarGapLocalPx: 12,
    })
  })

  it('captures interaction details for the current hit target and cursor surfaces', () => {
    const workspaceCanvas = document.createElement('div')
    workspaceCanvas.className = 'workspace-canvas'
    workspaceCanvas.dataset.coveDragSurfaceSelectionMode = 'true'

    const reactFlowNode = document.createElement('div')
    reactFlowNode.className = 'react-flow__node selected'

    const terminalNode = document.createElement('div')
    terminalNode.className = 'terminal-node terminal-node--selected-surface'

    const terminalBody = document.createElement('div')
    terminalBody.className = 'terminal-node__terminal'

    const xterm = document.createElement('div')
    xterm.className = 'xterm enable-mouse-events'

    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'

    const screen = document.createElement('div')
    screen.className = 'xterm-screen'

    const canvas = document.createElement('canvas')
    screen.append(canvas)
    xterm.append(viewport, screen)
    terminalBody.append(xterm)
    terminalNode.append(terminalBody)
    reactFlowNode.append(terminalNode)
    workspaceCanvas.append(reactFlowNode)
    document.body.append(workspaceCanvas)

    const originalElementFromPoint = document.elementFromPoint
    document.elementFromPoint = () => canvas

    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    window.getComputedStyle = ((element: Element) => {
      const cursor =
        element === xterm || element === viewport || element === screen || element === canvas
          ? 'default'
          : 'text'

      return {
        cursor,
        getPropertyValue: () => '',
      } as CSSStyleDeclaration
    }) as typeof window.getComputedStyle

    try {
      expect(
        captureTerminalInteractionDetails({
          container: terminalBody,
          rendererKind: 'webgl',
          point: { x: 120, y: 48 },
        }),
      ).toMatchObject({
        rendererKind: 'webgl',
        dragSurfaceSelectionMode: true,
        reactFlowNodeSelected: true,
        selectedSurfaceActive: true,
        xtermMouseEventsEnabled: true,
        xtermCursor: 'default',
        viewportCursor: 'default',
        screenCursor: 'default',
        canvasCursor: 'default',
        hitTarget: 'canvas',
        hitTargetCursor: 'default',
        hitTargetInsideTerminal: true,
        hitTargetInsideViewport: false,
        hitTargetInsideScreen: true,
      })
    } finally {
      document.elementFromPoint = originalElementFromPoint
      window.getComputedStyle = originalGetComputedStyle
      workspaceCanvas.remove()
    }
  })
})
