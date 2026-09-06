import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pixelNode } from './workspacePixelLayer.fixtures'
import { WorkspacePixelLayer } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspacePixelLayer'
import type { TerminalDataEvent } from '../../../src/shared/contracts/dto'

const mocks = vi.hoisted(() => ({
  onData: vi.fn(),
  unsubscribe: vi.fn(),
  store: { getState: vi.fn(), subscribe: vi.fn(), setState: vi.fn() },
}))
vi.mock('@xyflow/react', () => ({ useStoreApi: () => mocks.store }))
vi.mock('@app/renderer/shell/utils/ptyEventHub', () => ({ getPtyEventHub: () => mocks }))

describe('workspace pixel layer lifecycle', () => {
  let output: (event: TerminalDataEvent) => void
  let motionChange: () => void
  let storeChange: () => void
  let intersect: (entries: Array<{ isIntersecting: boolean }>) => void
  let now: number
  let reduced: boolean
  let visible: boolean
  let frames: Map<number, FrameRequestCallback>
  const disconnect = vi.fn()
  const unsubscribeStore = vi.fn()
  const removeMediaListener = vi.fn()
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }
  const tick = (at: number) => {
    now = at
    const pending = [...frames.values()]
    frames.clear()
    act(() => pending.forEach(callback => callback(now)))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    now = 0
    reduced = false
    visible = true
    frames = new Map()
    let frameId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id)
    })
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
      visible ? 'visible' : 'hidden',
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      get matches() {
        return reduced
      },
      addEventListener: (_event: string, listener: () => void) => {
        motionChange = listener
      },
      removeEventListener: removeMediaListener,
    } as MediaQueryList)
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof intersect) {
          intersect = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    mocks.onData.mockImplementation(listener => {
      output = listener
      return mocks.unsubscribe
    })
    mocks.store.getState.mockReturnValue({
      transform: [0, 0, 1],
      width: 1000,
      height: 800,
      nodeLookup: new Map(),
    })
    mocks.store.subscribe.mockImplementation(listener => {
      storeChange = listener
      return unsubscribeStore
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('draws once at idle, coalesces real session output and never writes runtime state', () => {
    const node = pixelNode()
    const before = structuredClone(node)
    const view = render(<WorkspacePixelLayer nodes={[node]} />)
    const canvas = view.getByTestId('workspace-pixel-layer')
    expect(canvas).toHaveAttribute('aria-hidden', 'true')
    tick(0)
    expect(context.fillRect).toHaveBeenCalled()
    expect(frames.size).toBe(0)
    act(() => output({ sessionId: 'other', data: 'Read Edit Bash' }))
    expect(frames.size).toBe(0)
    for (let i = 0; i < 100; i++) {
      output({ sessionId: 'session-1', data: '\u001b[2Janything' })
    }
    expect(frames.size).toBe(1)
    tick(40)
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'output')
    tick(1100)
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'idle')
    expect(frames.size).toBe(0)
    expect(node).toEqual(before)
    expect(mocks.store.setState).not.toHaveBeenCalled()
    view.unmount()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    expect(unsubscribeStore).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(removeMediaListener).toHaveBeenCalledOnce()
  })

  it('clears output on reduced motion, background visibility, offscreen and session rebinding', () => {
    const view = render(<WorkspacePixelLayer nodes={[pixelNode()]} />)
    const canvas = view.getByTestId('workspace-pixel-layer')
    tick(0)
    output({ sessionId: 'session-1', data: 'output' })
    tick(40)
    reduced = true
    act(() => motionChange())
    tick(80)
    expect(canvas).toHaveAttribute('data-cove-pixel-motion', 'static')
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'idle')
    output({ sessionId: 'session-1', data: 'still delivered by the hub' })
    expect(frames.size).toBe(0)
    reduced = false
    act(() => motionChange())
    tick(120)
    output({ sessionId: 'session-1', data: 'output' })
    visible = false
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(frames.size).toBe(0)
    expect(canvas).toHaveAttribute('data-cove-pixel-visibility', 'hidden')
    output({ sessionId: 'session-1', data: 'background output' })
    visible = true
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    tick(160)
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'idle')
    act(() => intersect([{ isIntersecting: false }]))
    act(() => storeChange())
    expect(frames.size).toBe(0)
    act(() => intersect([{ isIntersecting: true }]))
    tick(200)
    output({ sessionId: 'session-1', data: 'before rebind' })
    view.rerender(<WorkspacePixelLayer nodes={[pixelNode({ sessionId: 'session-2' })]} />)
    tick(240)
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'idle')
    view.unmount()
    output({ sessionId: 'session-2', data: 'late callback' })
    expect(frames.size).toBe(0)
  })
})
