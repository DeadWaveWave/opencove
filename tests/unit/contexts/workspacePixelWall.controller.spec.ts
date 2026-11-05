import { describe, expect, it, vi } from 'vitest'
import {
  createPixelWallController,
  type WallGlCallbacks,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallController'
import type { WallFrame } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallFrame'

function frameAt(now: number | null): WallFrame {
  return { now } as unknown as WallFrame
}

function harness({ glAvailable = true }: { glAvailable?: boolean } = {}) {
  let callbacks: WallGlCallbacks | null = null
  const gl = { draw: vi.fn(), dispose: vi.fn() }
  const fallback = { draw: vi.fn(), clear: vi.fn(), dispose: vi.fn() }
  const onChange = vi.fn()
  const requestRender = vi.fn()
  const buildFrame = vi.fn(frameAt)
  const controller = createPixelWallController({
    createGl: next => {
      callbacks = next
      return glAvailable ? gl : null
    },
    fallback,
    buildFrame,
    onChange,
    requestRender,
  })
  return {
    controller,
    gl,
    fallback,
    onChange,
    requestRender,
    buildFrame,
    lose: () => callbacks!.onLost(),
    restore: () => callbacks!.onRestored(),
  }
}

describe('pixel wall controller', () => {
  it('draws with WebGL when it is available', () => {
    const h = harness()
    expect(h.onChange).toHaveBeenLastCalledWith({ renderer: 'webgl', state: 'ready' })
    expect(h.controller.render(500)).toBe(true)
    expect(h.gl.draw).toHaveBeenCalledWith(frameAt(500))
    expect(h.fallback.draw).not.toHaveBeenCalled()
  })

  it('falls back to Canvas 2D when WebGL is unavailable, and keeps animating', () => {
    const h = harness({ glAvailable: false })
    expect(h.onChange).toHaveBeenLastCalledWith({ renderer: '2d', state: 'ready' })
    expect(h.controller.render(500)).toBe(true)
    expect(h.fallback.draw).toHaveBeenCalledWith(frameAt(500))
  })

  it('shows a static wall at once when the context is lost, and stops animating', () => {
    const h = harness()
    h.controller.render(100)
    h.lose()
    expect(h.onChange).toHaveBeenLastCalledWith({ renderer: '2d', state: 'lost' })
    expect(h.fallback.draw).toHaveBeenLastCalledWith(frameAt(null))
    h.gl.draw.mockClear()
    // Panning while lost still repaints the static wall, without a clock.
    expect(h.controller.render(200)).toBe(false)
    expect(h.fallback.draw).toHaveBeenLastCalledWith(frameAt(null))
    expect(h.gl.draw).not.toHaveBeenCalled()
  })

  it('returns to WebGL after the context is restored and clears the fallback', () => {
    const h = harness()
    h.lose()
    h.restore()
    expect(h.onChange).toHaveBeenLastCalledWith({ renderer: 'webgl', state: 'ready' })
    expect(h.fallback.clear).toHaveBeenCalled()
    expect(h.requestRender).toHaveBeenCalled()
    expect(h.controller.render(300)).toBe(true)
    expect(h.gl.draw).toHaveBeenLastCalledWith(frameAt(300))
  })

  it('releases both renderers on dispose and ignores late context events', () => {
    const h = harness()
    h.controller.dispose()
    expect(h.gl.dispose).toHaveBeenCalled()
    expect(h.fallback.dispose).toHaveBeenCalled()
    h.onChange.mockClear()
    h.lose()
    h.restore()
    expect(h.onChange).not.toHaveBeenCalled()
    expect(h.controller.render(400)).toBe(false)
  })
})
