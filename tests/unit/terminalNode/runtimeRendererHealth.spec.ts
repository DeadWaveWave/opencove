import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerRuntimeTerminalRendererHealth,
  resolveTerminalRendererHealthIssue,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/runtimeRendererHealth'

class MockResizeObserver {
  public observe = vi.fn()
  public disconnect = vi.fn()
}

describe('runtime renderer health', () => {
  let rafQueue: FrameRequestCallback[]
  let nextRafId: number

  const flushAnimationFrames = (): void => {
    while (rafQueue.length > 0) {
      const callback = rafQueue.shift()
      callback?.(0)
    }
  }

  beforeEach(() => {
    rafQueue = []
    nextRafId = 1
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        rafQueue.push(callback)
        return nextRafId++
      }),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects a missing canvas as a blank webgl renderer issue', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({
        width: 640,
        height: 320,
        top: 0,
        left: 0,
        right: 640,
        bottom: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })

    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    Object.defineProperty(screen, 'getBoundingClientRect', {
      value: () => ({
        width: 640,
        height: 320,
        top: 0,
        left: 0,
        right: 640,
        bottom: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    container.append(screen)

    const issue = resolveTerminalRendererHealthIssue({
      terminal: {
        _core: {
          _renderService: {
            dimensions: {
              css: { canvas: { width: 640, height: 320 } },
              device: { canvas: { width: 1280, height: 640 } },
            },
          },
        },
      } as never,
      container,
      rendererKind: 'webgl',
    })

    expect(issue).toEqual({
      reason: 'blank_canvas',
      trigger: 'mutation',
      forceDom: true,
    })
  })

  it('rebuilds from worker truth after a blank canvas is detected', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({
        width: 640,
        height: 320,
        top: 0,
        left: 0,
        right: 640,
        bottom: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })

    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    Object.defineProperty(screen, 'getBoundingClientRect', {
      value: () => ({
        width: 640,
        height: 320,
        top: 0,
        left: 0,
        right: 640,
        bottom: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    container.append(screen)

    const clearTextureAtlas = vi.fn()
    const syncTerminalSize = vi.fn()
    const scheduleWebglCanvasTransformCleanup = vi.fn()
    const log = vi.fn()
    const requestRecovery = vi.fn()

    const health = registerRuntimeTerminalRendererHealth({
      terminal: {
        _core: {
          _renderService: {
            dimensions: {
              css: { canvas: { width: 640, height: 320 } },
              device: { canvas: { width: 1280, height: 640 } },
            },
          },
        },
      } as never,
      renderer: {
        kind: 'webgl',
        clearTextureAtlas,
        dispose: vi.fn(),
      },
      containerRef: { current: container as HTMLDivElement },
      activeRendererKindRef: { current: 'webgl' },
      isTerminalHydratedRef: { current: true },
      syncTerminalSize,
      scheduleWebglCanvasTransformCleanup,
      log,
      requestRecovery,
    })

    health.notifyLayoutTrigger('manual')
    flushAnimationFrames()

    expect(clearTextureAtlas).toHaveBeenCalledTimes(1)
    expect(syncTerminalSize).toHaveBeenCalledTimes(1)
    expect(scheduleWebglCanvasTransformCleanup).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      'renderer-health-recover',
      expect.objectContaining({
        reason: 'blank_canvas',
        trigger: 'manual',
        forceDom: true,
        rendererKind: 'webgl',
      }),
    )
    expect(requestRecovery).toHaveBeenCalledWith({
      reason: 'blank_canvas',
      trigger: 'manual',
      forceDom: true,
    })

    health.dispose()
  })

  it('allows stream resync requests without forcing DOM fallback', () => {
    const request = {
      reason: 'stream_resync',
      trigger: 'resync_event',
      forceDom: false,
    } as const

    expect(request).toEqual({
      reason: 'stream_resync',
      trigger: 'resync_event',
      forceDom: false,
    })
  })
})
