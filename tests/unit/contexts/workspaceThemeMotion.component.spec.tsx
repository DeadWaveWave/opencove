import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePixelLayer } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspacePixelLayer'
import { applyThemeMotion } from '@contexts/plugins/presentation/renderer/themeMotion'
import {
  publishWorkspaceNodeCreationPrepared,
  publishWorkspaceNodeCreated,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCreationEvents'
import { publishWorkspaceNodesClosed } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeClosureEvents'
import { pixelNode } from './workspacePixelLayer.fixtures'

const mocks = vi.hoisted(() => ({
  store: { getState: vi.fn(), subscribe: vi.fn() },
  onData: vi.fn(),
}))
vi.mock('@xyflow/react', () => ({ useStoreApi: () => mocks.store }))
vi.mock('@app/renderer/shell/utils/ptyEventHub', () => ({ getPtyEventHub: () => mocks }))

let now = 0
let reduced = false
let media: MediaQueryList
let frames: Map<number, FrameRequestCallback>
let animations: Array<{
  element: Element
  cancel: ReturnType<typeof vi.fn>
  options: KeyframeAnimationOptions
}>
let restoreAnimate: PropertyDescriptor | undefined
const disabled = { background: false, creation: false, closing: false, working: false }
const enabled = { background: true, creation: true, closing: true, working: true }
const node = pixelNode({ kind: 'note' })

function tick(at: number) {
  now = at
  const pending = [...frames.values()]
  frames.clear()
  act(() => pending.forEach(callback => callback(now)))
}

function scene(options = enabled) {
  return (
    <div>
      <div className="react-flow__node" data-id={node.id}>
        <div className="cove-node-presentation">
          <div className="runtime" />
        </div>
      </div>
      <WorkspacePixelLayer nodes={[node]} options={options} />
    </div>
  )
}

beforeEach(() => {
  now = 0
  reduced = false
  frames = new Map()
  animations = []
  let frameId = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
    frames.delete(id)
  })
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.stubGlobal(
    'CSSStyleSheet',
    class {
      cssRules = []
      replaceSync() {}
    },
  )
  Object.defineProperty(document, 'adoptedStyleSheets', {
    configurable: true,
    writable: true,
    value: [],
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    createLinearGradient: () => ({ addColorStop() {} }),
  } as unknown as CanvasRenderingContext2D)
  media = new EventTarget() as MediaQueryList
  Object.defineProperty(media, 'matches', { get: () => reduced })
  vi.spyOn(window, 'matchMedia').mockReturnValue(media)
  mocks.store.getState.mockReturnValue({
    transform: [20, 10, 1],
    width: 1000,
    height: 800,
    nodeLookup: new Map(),
  })
  mocks.store.subscribe.mockReturnValue(() => {})
  mocks.onData.mockReturnValue(() => {})
  restoreAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: function (this: Element, _frames: Keyframe[], options: KeyframeAnimationOptions) {
      let reject!: (error: unknown) => void
      const finished = new Promise<void>((_, rejectPromise) => {
        reject = rejectPromise
      })
      const cancel = vi.fn(() => reject(new DOMException('Cancelled', 'AbortError')))
      animations.push({ element: this, options, cancel })
      return { cancel, finished }
    },
  })
})

afterEach(() => {
  cleanup()
  applyThemeMotion()()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (restoreAnimate) {
    Object.defineProperty(Element.prototype, 'animate', restoreAnimate)
  } else {
    Reflect.deleteProperty(Element.prototype, 'animate')
  }
})

describe('advanced theme effects in the canvas lifecycle', () => {
  it('opens only when ready, uses theme timing and cancels masks/effects on switch without replacing runtime', () => {
    applyThemeMotion({
      creation: {
        preset: 'custom',
        durationMs: 700,
        easing: 'linear',
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
      },
      background: { preset: 'custom' },
    })
    const view = render(scene())
    const runtime = view.container.querySelector('.runtime')
    act(() => {
      publishWorkspaceNodeCreationPrepared([node.id], now)
      publishWorkspaceNodeCreated(node.id)
    })
    tick(10)
    const opening = animations.find(animation =>
      animation.element.classList.contains('cove-node-presentation'),
    )
    expect(opening?.options).toMatchObject({ duration: 700, easing: 'linear' })
    expect(view.container.querySelector('[data-cove-part="effect-creation"]')).toHaveStyle({
      left: '120px',
      top: '90px',
    })
    tick(500)
    expect(view.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
      'data-cove-pixel-assembly',
      'assembling',
    )
    act(() => {
      applyThemeMotion({ creation: { preset: 'none' } })
    })
    tick(510)
    expect(opening?.cancel).toHaveBeenCalledOnce()
    expect(view.container.querySelector('[data-cove-part="effect-creation"]')).toBeNull()
    expect(view.container.querySelector('[data-cove-effect="creation"]')).toBeNull()
    expect(view.container.querySelector('.runtime')).toBe(runtime)
    expect(view.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
      'data-cove-pixel-assembly',
      'idle',
    )
  })

  it('user toggles and reduced motion cancel custom effects and prevent new ones', () => {
    applyThemeMotion({
      creation: { preset: 'custom' },
      closing: { preset: 'custom' },
      background: { preset: 'custom' },
    })
    const view = render(scene(disabled))
    act(() => {
      publishWorkspaceNodeCreationPrepared([node.id], now)
      publishWorkspaceNodeCreated(node.id)
    })
    tick(10)
    expect(animations).toHaveLength(0)
    view.rerender(scene())
    tick(20)
    expect(view.container.querySelector('[data-cove-part="effect-background"]')).not.toBeNull()
    act(() => {
      reduced = true
      media.dispatchEvent(new Event('change'))
    })
    tick(30)
    expect(view.container.querySelector('[data-cove-part="effect-background"]')).toBeNull()
    const count = animations.length
    act(() => {
      publishWorkspaceNodeCreationPrepared([node.id], now)
      publishWorkspaceNodeCreated(node.id)
      publishWorkspaceNodesClosed([node.id])
    })
    tick(40)
    expect(animations).toHaveLength(count)
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
  })

  it('retains only close geometry and releases all custom overlays and animations on unmount', () => {
    applyThemeMotion({
      closing: { preset: 'custom', durationMs: 650 },
      background: { preset: 'custom' },
    })
    const view = render(scene())
    tick(10)
    act(() => publishWorkspaceNodesClosed([node.id]))
    tick(60)
    expect(view.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
      'data-cove-pixel-burst',
      'bursting',
    )
    const closing = view.container.querySelector('[data-cove-part="effect-closing"]')
    expect(closing).not.toBeNull()
    expect(closing?.querySelector('.runtime')).toBeNull()
    tick(500)
    expect(view.container.querySelector('[data-cove-part="effect-closing"]')).toBe(closing)
    view.unmount()
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
    expect(frames.size).toBe(0)
    expect(document.adoptedStyleSheets).toHaveLength(0)
  })
})
