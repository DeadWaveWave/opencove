import { describe, expect, it } from 'vitest'
import {
  captureTerminalDiagnosticsSnapshot,
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
})
