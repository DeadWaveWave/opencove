import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pixelNode } from './workspacePixelLayer.fixtures'
import { WorkspacePixelLayer } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspacePixelLayer'
import { publishWindowSignal } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/windowSignalEvents'
import { SPACE_VISUAL_SCALE_EVENT } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/spaceVisualScale'

const store = vi.hoisted(() => ({ getState: vi.fn(), subscribe: vi.fn(() => () => {}) }))
vi.mock('@xyflow/react', () => ({ useStoreApi: () => store }))
vi.mock('@app/renderer/shell/utils/ptyEventHub', () => ({
  getPtyEventHub: () => ({ onData: () => () => {} }),
}))

describe('pixel signal routing and lifetime', () => {
  let now: number
  let hidden: boolean
  let reduced: boolean
  let motionChange: () => void
  let storeChange: () => void
  let frames: Map<number, FrameRequestCallback>
  const context = {
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  }
  const tick = (at: number) => {
    now = at
    const pending = [...frames.values()]
    frames.clear()
    act(() => pending.forEach(callback => callback(at)))
  }
  const options = { background: false, creation: false, closing: false, working: true }
  const nodes = [
    pixelNode({ kind: 'agent', status: 'standby' }),
    { ...pixelNode({ kind: 'note' }), id: 'note' },
  ]
  const view = (working = true) =>
    render(
      <div className="workspace-canvas" data-cove-lod="near">
        <WorkspacePixelLayer nodes={nodes} options={{ ...options, working }} />
      </div>,
    )
  beforeEach(() => {
    now = 0
    hidden = false
    reduced = false
    frames = new Map()
    vi.clearAllMocks()
    vi.stubGlobal('CSS', { escape: (s: string) => s })
    let frameId = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id)
    })
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
      hidden ? 'hidden' : 'visible',
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      get matches() {
        return reduced
      },
      addEventListener: (_: string, fn: () => void) => {
        motionChange = fn
      },
      removeEventListener: () => {},
    } as MediaQueryList)
    store.subscribe.mockImplementation(listener => {
      storeChange = listener
      return () => {}
    })
    store.getState.mockReturnValue({
      transform: [0, 0, 1],
      width: 1000,
      height: 800,
      nodeLookup: new Map(),
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['complete', 26],
    ['fail', 14],
  ] as const)(
    'paints %s from its event, including while the ambient background is off',
    (kind, count) => {
      const mounted = view()
      tick(0)
      expect(context.fillRect).not.toHaveBeenCalled()
      expect(frames.size).toBe(0)
      act(() => publishWindowSignal({ kind, nodeId: nodes[0].id }))
      tick(100)
      expect(context.fillRect).toHaveBeenCalledTimes(count)
      expect(mounted.getByTestId('workspace-pixel-layer')).not.toHaveAttribute('hidden')
      tick(2000)
      expect(frames.size).toBe(0)
      expect(mounted.getByTestId('workspace-pixel-layer')).toHaveAttribute('hidden')
      mounted.unmount()
      context.fillRect.mockClear()
      act(() => publishWindowSignal({ kind, nodeId: nodes[0].id }))
      tick(2100)
      expect(context.fillRect).not.toHaveBeenCalled()
    },
  )

  it('sheds ten sparks per visible window only on actual LOD changes, using current projection', () => {
    const mounted = view()
    tick(0)
    const scope = mounted.container.firstElementChild!
    act(() => scope.dispatchEvent(new Event(SPACE_VISUAL_SCALE_EVENT)))
    tick(100)
    expect(context.fillRect).not.toHaveBeenCalled()
    // The LOD owner dispatches before the pixel layer's store subscriber refreshes its cache.
    store.getState.mockReturnValue({
      transform: [50, 20, 0.2],
      width: 1000,
      height: 800,
      nodeLookup: new Map(),
    })
    act(() => {
      scope.setAttribute('data-cove-lod', 'far')
      scope.dispatchEvent(new Event(SPACE_VISUAL_SCALE_EVENT))
      storeChange()
    })
    tick(200)
    expect(context.fillRect).toHaveBeenCalledTimes(20)
    for (const [x, y] of context.fillRect.mock.calls) {
      expect(x).toBeLessThan(140)
      expect(y).toBeLessThan(90)
    }
    tick(1000)
    expect(frames.size).toBe(0)
    context.fillRect.mockClear()
    act(() => scope.dispatchEvent(new Event(SPACE_VISUAL_SCALE_EVENT)))
    tick(1100)
    expect(context.fillRect).not.toHaveBeenCalled()
    act(() => {
      scope.setAttribute('data-cove-lod', 'near')
      scope.dispatchEvent(new Event(SPACE_VISUAL_SCALE_EVENT))
    })
    tick(1200)
    expect(context.fillRect).toHaveBeenCalledTimes(20)
  })

  it.each(['disabled', 'reduced', 'hidden'] as const)(
    'suppresses and clears particles when %s, without replay',
    mode => {
      const mounted = view()
      tick(0)
      act(() => publishWindowSignal({ kind: 'complete', nodeId: nodes[0].id }))
      tick(100)
      expect(context.fillRect).toHaveBeenCalledTimes(26)
      context.fillRect.mockClear()
      if (mode === 'disabled') {
        mounted.rerender(
          <div className="workspace-canvas" data-cove-lod="near">
            <WorkspacePixelLayer nodes={nodes} options={{ ...options, working: false }} />
          </div>,
        )
      }
      if (mode === 'reduced') {
        act(() => {
          reduced = true
          motionChange()
        })
      }
      if (mode === 'hidden') {
        act(() => {
          hidden = true
          document.dispatchEvent(new Event('visibilitychange'))
        })
      }
      act(() => publishWindowSignal({ kind: 'fail', nodeId: nodes[0].id }))
      tick(200)
      expect(context.fillRect).not.toHaveBeenCalled()
      expect(frames.size).toBe(0)
      if (mode === 'disabled') {
        mounted.rerender(
          <div className="workspace-canvas" data-cove-lod="near">
            <WorkspacePixelLayer nodes={nodes} options={options} />
          </div>,
        )
      }
      if (mode === 'reduced') {
        act(() => {
          reduced = false
          motionChange()
        })
      }
      if (mode === 'hidden') {
        act(() => {
          hidden = false
          document.dispatchEvent(new Event('visibilitychange'))
        })
      }
      tick(300)
      expect(context.fillRect).not.toHaveBeenCalled()
      expect(frames.size).toBe(0)
    },
  )
})
