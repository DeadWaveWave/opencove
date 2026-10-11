import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPixelEffectPreview } from '@contexts/settings/presentation/renderer/settingsPanel/pixelEffectPreview'
import { PIXEL_ASSEMBLY_MS } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/assembly'
import { PIXEL_BURST_MS } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burst'
import * as bursts from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burstRenderer'
import * as assemblies from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/assemblyRenderer'
import * as backgrounds from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/renderer'
import {
  applyThemeMotion,
  readThemeMotion,
} from '@contexts/plugins/presentation/renderer/themeMotion'

const effects = {
  canvasPixelBackgroundEnabled: false,
  nodeCreationPixelEffectEnabled: true,
  nodeClosePixelEffectEnabled: true,
  agentWorkingPixelEffectEnabled: false,
}
const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
}
let now = 0
let reduced = false
let motionChange: () => void
let intersect: (entries: Array<{ isIntersecting: boolean }>) => void
let frames: Map<number, FrameRequestCallback>
let dispose: (() => void) | undefined
const disconnect = vi.fn()
const removeMotion = vi.fn()

function fixture() {
  const scope = document.createElement('div')
  const node = document.createElement('div')
  const background = document.createElement('canvas')
  const foreground = document.createElement('canvas')
  node.className = 'settings-pixel-preview__node'
  node.dataset.id = 'settings-preview-terminal'
  scope.getBoundingClientRect = () => new DOMRect(0, 0, 420, 242)
  foreground.getBoundingClientRect = () => new DOMRect(0, 0, 420, 242)
  node.getBoundingClientRect = () => new DOMRect(220, 80, 150, 118)
  scope.append(background, node, foreground)
  document.body.append(scope)
  return { scope, node, background, foreground }
}

function tick(at: number) {
  now = at
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach(callback => callback(now))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  now = 0
  reduced = false
  frames = new Map()
  let id = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++id, callback)
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(frame => {
    frames.delete(frame)
  })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    get matches() {
      return reduced
    },
    addEventListener: (_event: string, callback: () => void) => {
      motionChange = callback
    },
    removeEventListener: removeMotion,
  } as MediaQueryList)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = disconnect
    },
  )
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
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  applyThemeMotion()()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('isolated settings pixel preview', () => {
  it('previews the applied custom theme without changing global motion and cancels on a theme switch', () => {
    applyThemeMotion({
      background: { preset: 'custom' },
      working: { preset: 'custom' },
      closing: { preset: 'custom', durationMs: 640 },
      creation: { preset: 'custom', durationMs: 720, easing: 'linear' },
    })
    const applied = readThemeMotion()
    const nodes = fixture()
    const cancel = vi.fn()
    nodes.node.animate = vi.fn(
      () => ({ cancel, finished: new Promise(() => {}) }) as unknown as Animation,
    )
    const onState = vi.fn()
    const controller = createPixelEffectPreview(
      nodes,
      { ...effects, canvasPixelBackgroundEnabled: true, agentWorkingPixelEffectEnabled: true },
      onState,
    )
    dispose = controller.dispose
    tick(0)
    expect(nodes.scope.querySelector('[data-cove-part="effect-background"]')).not.toBeNull()
    expect(nodes.scope.querySelector('[data-cove-part="effect-working"]')).not.toBeNull()
    controller.replay()
    tick(40)
    expect(nodes.scope.querySelector('[data-cove-part="effect-closing"]')).not.toBeNull()
    tick(760)
    expect(nodes.node.animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: 720, easing: 'linear' }),
    )
    expect(nodes.node.style.visibility).toBe('')
    expect(readThemeMotion()).toBe(applied)
    applyThemeMotion({ background: { preset: 'none' }, working: { preset: 'none' } })
    expect(cancel).toHaveBeenCalledOnce()
    expect(nodes.scope.querySelector('[data-cove-part="effect-creation"]')).toBeNull()
    expect(onState).toHaveBeenLastCalledWith({ playing: false, reducedMotion: false })
  })

  it('uses the shared close/reveal painters and returns to idle without creating runtime nodes', () => {
    const nodes = fixture()
    const onState = vi.fn()
    const drawBurst = vi.spyOn(bursts, 'drawPixelBursts')
    const drawAssembly = vi.spyOn(assemblies, 'drawPixelAssemblies')
    const controller = createPixelEffectPreview(nodes, effects, onState)
    dispose = controller.dispose
    tick(0)
    expect(frames.size).toBe(0)
    controller.replay()
    expect(nodes.node.style.visibility).toBe('hidden')
    tick(40)
    expect(drawBurst.mock.lastCall?.[0].frames).toHaveLength(1)
    const revealAt = PIXEL_BURST_MS + 120
    tick(revealAt)
    expect(nodes.node.style.visibility).toBe('')
    expect(drawAssembly.mock.lastCall?.[0].frames).toHaveLength(1)
    expect(document.querySelectorAll('.react-flow__node')).toHaveLength(0)
    tick(revealAt + PIXEL_ASSEMBLY_MS)
    expect(onState).toHaveBeenLastCalledWith({ playing: false, reducedMotion: false })
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['canvasPixelBackgroundEnabled', 'agentWorkingPixelEffectEnabled'] as const)(
    'runs %s only while visible and stops immediately for reduced motion',
    flag => {
      const onState = vi.fn()
      const drawBackground = vi.spyOn(backgrounds, 'drawPixelLayer')
      const controller = createPixelEffectPreview(fixture(), { ...effects, [flag]: true }, onState)
      dispose = controller.dispose
      tick(0)
      expect(frames.size).toBe(1)
      intersect([{ isIntersecting: false }])
      expect(frames.size).toBe(0)
      intersect([{ isIntersecting: true }])
      expect(frames.size).toBe(1)
      reduced = true
      motionChange()
      tick(40)
      expect(drawBackground.mock.lastCall?.[0].reducedMotion).toBe(true)
      expect(frames.size).toBe(0)
      controller.replay()
      expect(onState).toHaveBeenLastCalledWith({ playing: false, reducedMotion: true })
      expect(frames.size).toBe(0)
    },
  )

  it('respects both disabled transition flags and removes every listener on disposal', () => {
    const nodes = fixture()
    const drawBurst = vi.spyOn(bursts, 'drawPixelBursts')
    const drawAssembly = vi.spyOn(assemblies, 'drawPixelAssemblies')
    const controller = createPixelEffectPreview(
      nodes,
      { ...effects, nodeCreationPixelEffectEnabled: false, nodeClosePixelEffectEnabled: false },
      vi.fn(),
    )
    dispose = controller.dispose
    tick(0)
    controller.replay()
    tick(40)
    expect(drawBurst.mock.lastCall?.[0].frames).toEqual([])
    tick(120)
    expect(drawAssembly.mock.lastCall?.[0].frames).toEqual([])
    expect(nodes.node.style.visibility).toBe('')
    controller.dispose()
    dispose = undefined
    expect(disconnect).toHaveBeenCalledTimes(2)
    expect(removeMotion).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('opencove-theme-changed'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
