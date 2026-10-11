import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyThemeMotion } from '@contexts/plugins/presentation/renderer/themeMotion'
import { createThemeEffects } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/themeEffects'

const options = { background: true, creation: true, closing: true, working: true }
const viewport = { x: 0, y: 0, zoom: 1, width: 1000, height: 800 }
const frame = { id: 'node', sessionId: 'session', rect: { x: 50, y: 40, width: 300, height: 200 } }
let restoreAnimate: PropertyDescriptor | undefined
let scope: HTMLDivElement
let effects: ReturnType<typeof createThemeEffects>
let animations: Array<{
  element: Element
  frames: Keyframe[]
  options: KeyframeAnimationOptions
  finish: () => void
  cancel: ReturnType<typeof vi.fn>
}>

beforeEach(() => {
  scope = document.createElement('div')
  document.body.append(scope)
  effects = createThemeEffects(scope)
  animations = []
  restoreAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
      let finish!: () => void
      let reject!: (error: unknown) => void
      const finished = new Promise<void>((resolve, rejectPromise) => {
        finish = resolve
        reject = rejectPromise
      })
      const cancel = vi.fn(() => reject(new DOMException('Cancelled', 'AbortError')))
      animations.push({ element: this, frames, options: timing, finish, cancel })
      return { cancel, finished }
    },
  })
})

afterEach(() => {
  effects.dispose()
  applyThemeMotion()()
  scope.remove()
  if (restoreAnimate) {
    Object.defineProperty(Element.prototype, 'animate', restoreAnimate)
  } else {
    Reflect.deleteProperty(Element.prototype, 'animate')
  }
})

describe('custom theme effect endpoint and projection ownership', () => {
  it('converges live creation to its steady styles before releasing animation ownership', async () => {
    applyThemeMotion({
      creation: {
        preset: 'custom',
        durationMs: 640,
        keyframes: [
          { opacity: 0, transform: 'scale(0.5)' },
          { opacity: 0.3, transform: 'scale(0.8)', filter: 'blur(8px)' },
        ],
      },
    })
    const node = document.createElement('div')
    node.style.cssText =
      'opacity:0.85;transform:translateX(3px);filter:contrast(1.2);clip-path:inset(2px)'
    scope.append(node)
    effects.startCreation(frame.id, node)
    expect(animations[0].frames.at(-1)).toMatchObject({
      opacity: '0.85',
      transform: 'translateX(3px)',
      filter: 'contrast(1.2)',
      clipPath: 'inset(2px)',
      offset: 1,
    })
    expect(animations[0].options.duration).toBe(640)
    animations[0].finish()
    await Promise.resolve()
    expect(animations[0].cancel).toHaveBeenCalledOnce()
    expect(node.dataset.coveEffect).toBeUndefined()
    expect(node.style.opacity).toBe('0.85')
    expect(node.style.transform).toBe('translateX(3px)')
  })

  it('fades temporary decoration to zero and appends the host endpoint after explicit earlier offsets', () => {
    applyThemeMotion({
      creation: { preset: 'custom', keyframes: [{ opacity: 0 }, { opacity: 0.8, offset: 0.7 }] },
      closing: { preset: 'custom', keyframes: [{ opacity: 0.8 }, { opacity: 1 }] },
    })
    effects.sync(viewport, [], [frame], [frame], options, false)
    expect(animations).toHaveLength(2)
    expect(animations[0].frames).toEqual([
      { opacity: 0 },
      { opacity: 0.8, offset: 0.7 },
      { opacity: 0, offset: 1 },
    ])
    expect(animations[1].frames.at(-1)).toMatchObject({ opacity: 0, offset: 1 })
  })

  it('cancels live creation once the projected frame is removed or leaves the viewport', async () => {
    applyThemeMotion({ creation: { preset: 'custom' } })
    const node = document.createElement('div')
    scope.append(node)
    effects.startCreation(frame.id, node)
    effects.sync(viewport, [], [frame], [], options, false)
    const live = animations[0]
    expect(live.cancel).not.toHaveBeenCalled()
    effects.sync(viewport, [], [], [], options, false)
    expect(live.cancel).toHaveBeenCalledOnce()
    expect(node.dataset.coveEffect).toBeUndefined()
    effects.startCreation(frame.id, node)
    await Promise.resolve()
    expect(node.dataset.coveEffect).toBe('creation')
  })

  it('updates continuous effect geometry without restarting keyed nodes and cancels them for reduced motion', () => {
    applyThemeMotion({ background: { preset: 'custom' }, working: { preset: 'custom' } })
    const node = { ...frame, tone: 'working' as const, acceptsOutput: false }
    effects.sync(viewport, [node], [], [], options, false)
    const working = scope.querySelector('[data-cove-part="effect-working"]')
    effects.sync(viewport, [{ ...node, rect: { ...node.rect, x: 120 } }], [], [], options, false)
    expect(scope.querySelector('[data-cove-part="effect-working"]')).toBe(working)
    expect(working).toHaveStyle({ left: '120px' })
    expect(animations).toHaveLength(2)
    effects.sync(viewport, [node], [], [], options, true)
    expect(scope.querySelector('[data-cove-part="effect-working"]')).toBeNull()
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
  })
})
