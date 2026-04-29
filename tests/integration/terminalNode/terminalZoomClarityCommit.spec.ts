import { describe, expect, it } from 'vitest'
import {
  captureTerminalScrollState,
  restoreTerminalScrollState,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/effectiveDevicePixelRatio'

function createIntegrationTerminal() {
  const terminal = {
    buffer: {
      active: {
        baseY: 240,
        viewportY: 210,
      },
    },
    scrollToLine: (line: number) => {
      terminal.buffer.active.viewportY = line
    },
    _core: {
      _bufferService: {
        isUserScrolling: true,
        buffer: {
          ydisp: 210,
        },
      },
      _viewport: {
        queueSync: (ydisp?: number) => {
          if (typeof ydisp === 'number') {
            terminal.buffer.active.viewportY = ydisp
          }
        },
        scrollToLine: (line: number) => {
          terminal.buffer.active.viewportY = line
        },
      },
    },
  }

  return terminal
}

describe('terminal zoom clarity scroll guard', () => {
  it('restores viewportY and user-scrolled state after renderer refresh side effects', () => {
    const terminal = createIntegrationTerminal()
    const snapshot = captureTerminalScrollState(terminal as never)

    terminal.buffer.active.viewportY = 240
    terminal._core._bufferService.isUserScrolling = false
    terminal._core._bufferService.buffer.ydisp = 240

    restoreTerminalScrollState(terminal as never, snapshot)

    expect(terminal.buffer.active.viewportY).toBe(210)
    expect(terminal._core._bufferService.isUserScrolling).toBe(true)
    expect(terminal._core._bufferService.buffer.ydisp).toBe(210)
  })
})
