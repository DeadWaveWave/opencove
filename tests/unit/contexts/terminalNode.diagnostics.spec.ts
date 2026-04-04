import { describe, expect, it } from 'vitest'
import {
  captureTerminalDiagnosticsSnapshot,
  captureTerminalInteractionDetails,
  resolveTerminalBufferKind,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/diagnostics'

describe('terminal diagnostics helpers', () => {
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
