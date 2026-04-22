import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import {
  installTerminalEffectiveDevicePixelRatioController,
  resolveTerminalEffectiveDevicePixelRatio,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/effectiveDevicePixelRatio'

function createTerminalHarness(input?: {
  baseDevicePixelRatio?: number
  baseY?: number
  viewportY?: number
  isUserScrolling?: boolean
}) {
  const scrollListeners = new Set<() => void>()
  const resizeListeners = new Set<() => void>()
  const ownerWindow = {
    devicePixelRatio: input?.baseDevicePixelRatio ?? 1,
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'resize' && typeof listener === 'function') {
        resizeListeners.add(listener)
      }
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'resize' && typeof listener === 'function') {
        resizeListeners.delete(listener)
      }
    }),
  } as unknown as Window
  const renderService = {
    handleDevicePixelRatioChange: vi.fn(),
  }
  const coreBrowserService = {
    _onDprChange: {
      fire: vi.fn(() => {
        renderService.handleDevicePixelRatioChange()
      }),
    },
  }
  const terminal = {
    element: {
      ownerDocument: {
        defaultView: ownerWindow,
      },
    },
    buffer: {
      active: {
        baseY: input?.baseY ?? 0,
        viewportY: input?.viewportY ?? input?.baseY ?? 0,
      },
    },
    scrollToLine: (line: number) => {
      ;(
        terminal as unknown as {
          buffer: { active: { viewportY: number } }
        }
      ).buffer.active.viewportY = line
    },
    onScroll: (listener: () => void) => {
      scrollListeners.add(listener)
      return {
        dispose: () => {
          scrollListeners.delete(listener)
        },
      }
    },
    _core: {
      _bufferService: {
        isUserScrolling: input?.isUserScrolling ?? false,
        buffer: {
          ydisp: input?.viewportY ?? input?.baseY ?? 0,
        },
      },
      _coreBrowserService: coreBrowserService,
      _renderService: renderService,
      _viewport: {
        queueSync: (ydisp?: number) => {
          if (typeof ydisp === "number") {
            ;(
              terminal as unknown as {
                buffer: { active: { viewportY: number } }
              }
            ).buffer.active.viewportY = ydisp
          }
        },
        scrollToLine: (line: number) => {
          ;(
            terminal as unknown as {
              buffer: { active: { viewportY: number } }
            }
          ).buffer.active.viewportY = line
        },
      },
    },
  } as unknown as Terminal

  return {
    terminal,
    coreBrowserService,
    ownerWindow,
    renderService,
    emitScroll(nextViewportY: number, nextBaseY?: number) {
      ;(
        terminal as unknown as {
          buffer: { active: { baseY: number; viewportY: number } }
        }
      ).buffer.active.viewportY = nextViewportY
      ;(
        terminal as unknown as {
          _core: { _bufferService: { buffer: { ydisp: number } } }
        }
      )._core._bufferService.buffer.ydisp = nextViewportY
      if (typeof nextBaseY === 'number') {
        ;(
          terminal as unknown as {
            buffer: { active: { baseY: number; viewportY: number } }
          }
        ).buffer.active.baseY = nextBaseY
      }

      for (const listener of scrollListeners) {
        listener()
      }
    },
    emitResize(nextBaseDevicePixelRatio: number) {
      ;(ownerWindow as unknown as { devicePixelRatio: number }).devicePixelRatio =
        nextBaseDevicePixelRatio
      for (const listener of resizeListeners) {
        listener()
      }
    },
    readState() {
      const typedTerminal = terminal as unknown as {
        buffer: { active: { baseY: number; viewportY: number } }
        _core: {
          _bufferService: {
            isUserScrolling: boolean
            buffer: { ydisp: number }
          }
        }
      }

      return {
        baseY: typedTerminal.buffer.active.baseY,
        viewportY: typedTerminal.buffer.active.viewportY,
        isUserScrolling: typedTerminal._core._bufferService.isUserScrolling,
        ydisp: typedTerminal._core._bufferService.buffer.ydisp,
      }
    },
  }
}

describe('terminal effective device pixel ratio', () => {
  it('keeps the window DPR when the viewport is not zoomed in', () => {
    expect(
      resolveTerminalEffectiveDevicePixelRatio({
        baseDevicePixelRatio: 1.25,
        viewportZoom: 1,
      }),
    ).toBe(1.25)

    expect(
      resolveTerminalEffectiveDevicePixelRatio({
        baseDevicePixelRatio: 1.25,
        viewportZoom: 0.75,
      }),
    ).toBe(1.25)
  })

  it('applies a higher DPR immediately when the terminal is already at the bottom', () => {
    const harness = createTerminalHarness({
      baseDevicePixelRatio: 1.25,
      baseY: 120,
      viewportY: 120,
    })

    const controller = installTerminalEffectiveDevicePixelRatioController({
      terminal: harness.terminal,
      initialViewportZoom: 1.5,
      nodeId: 'node-at-bottom',
    })

    expect(harness.renderService.handleDevicePixelRatioChange).toHaveBeenCalledTimes(1)
    expect((harness.coreBrowserService as unknown as { dpr?: number }).dpr).toBeCloseTo(1.875, 5)

    controller.dispose()

    expect(Object.prototype.hasOwnProperty.call(harness.coreBrowserService, 'dpr')).toBe(false)
  })

  it('defers clarity while viewport interaction is active and commits after it settles', () => {
    const harness = createTerminalHarness({
      baseDevicePixelRatio: 1.25,
      baseY: 120,
      viewportY: 80,
      isUserScrolling: true,
    })

    const controller = installTerminalEffectiveDevicePixelRatioController({
      terminal: harness.terminal,
      initialViewportZoom: 1,
      initialViewportInteractionActive: true,
      nodeId: 'node-user-scrolled',
    })

    controller.setViewportZoom(1.5)
    expect(harness.renderService.handleDevicePixelRatioChange).not.toHaveBeenCalled()

    controller.setViewportInteractionActive(false)

    expect(harness.renderService.handleDevicePixelRatioChange).toHaveBeenCalledTimes(1)
    expect(harness.readState()).toMatchObject({
      baseY: 120,
      viewportY: 80,
      isUserScrolling: true,
    })
  })

  it('does not require returning to bottom before applying a settled refresh', () => {
    const harness = createTerminalHarness({
      baseDevicePixelRatio: 1.25,
      baseY: 180,
      viewportY: 150,
      isUserScrolling: true,
    })

    const controller = installTerminalEffectiveDevicePixelRatioController({
      terminal: harness.terminal,
      initialViewportZoom: 1,
      initialViewportInteractionActive: true,
      nodeId: 'node-still-in-history',
    })

    controller.setViewportZoom(1.6)
    controller.setViewportInteractionActive(false)

    expect(harness.renderService.handleDevicePixelRatioChange).toHaveBeenCalledTimes(1)
    expect((harness.coreBrowserService as unknown as { dpr?: number }).dpr).toBeCloseTo(2, 5)
  })

  it('recomputes the effective DPR when the window DPR changes', () => {
    const harness = createTerminalHarness({
      baseDevicePixelRatio: 1.25,
      baseY: 120,
      viewportY: 120,
    })

    installTerminalEffectiveDevicePixelRatioController({
      terminal: harness.terminal,
      initialViewportZoom: 1.5,
      nodeId: 'node-window-dpr',
    })

    expect(harness.renderService.handleDevicePixelRatioChange).toHaveBeenCalledTimes(1)

    harness.emitResize(1.5)

    expect(harness.renderService.handleDevicePixelRatioChange).toHaveBeenCalledTimes(2)
    expect((harness.coreBrowserService as unknown as { dpr?: number }).dpr).toBeCloseTo(2.25, 5)
  })
})
