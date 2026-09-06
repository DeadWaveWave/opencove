import { describe, expect, it, vi } from 'vitest'
import {
  drawPixelLayer,
  type PixelTheme,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/renderer'
import {
  createPixelActivity,
  type PixelNode,
  type PixelViewport,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/model'

const theme: PixelTheme = {
  blue: '#5b9cf0',
  cyan: '#55bddc',
  mint: '#70ddbc',
  warning: '#e4af74',
  danger: '#ef8f95',
  gap: 17,
  opacity: 0.72,
}
const viewport: PixelViewport = { x: 0, y: 0, zoom: 1, width: 1120, height: 640 }

function drawFrame(now: number, reducedMotion = false, view = viewport, nodes: PixelNode[] = []) {
  const canvas = document.createElement('canvas')
  const pixels: Array<{ x: number; y: number; size: number; alpha: number }> = []
  const gradient = { addColorStop: vi.fn() }
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    fillRect(x: number, y: number, width: number) {
      pixels.push({ x, y, size: width, alpha: this.globalAlpha })
    },
  }
  const before = { ...view }
  drawPixelLayer({
    canvas,
    context: context as unknown as CanvasRenderingContext2D,
    viewport: view,
    nodes,
    activity: createPixelActivity(),
    theme,
    now,
    reducedMotion,
  })
  expect(view).toEqual(before)
  return { canvas, pixels, context, gradient }
}

describe('flowing Pixel background', () => {
  it('moves the wave field and scan fronts continuously even without terminal output', () => {
    const first = drawFrame(0)
    const later = drawFrame(1600)
    expect(later.pixels).not.toEqual(first.pixels)
    const changed = later.pixels.filter((pixel, index) => {
      const initial = first.pixels[index]
      return !initial || Math.abs(pixel.alpha - initial.alpha) > 0.025
    })
    expect(changed.length).toBeGreaterThan(first.pixels.length * 0.12)
  })

  it('retains visible fine-grained ridges without seven-pixel blocks', () => {
    const { pixels } = drawFrame(2400)
    expect(Math.min(...pixels.map(pixel => pixel.size))).toBeGreaterThanOrEqual(1)
    expect(Math.max(...pixels.map(pixel => pixel.size))).toBeGreaterThan(2.5)
    expect(Math.max(...pixels.map(pixel => pixel.size))).toBeLessThanOrEqual(4)
    expect(pixels.filter(pixel => pixel.size > 2 && pixel.alpha > 0.16).length).toBeGreaterThan(50)
    expect(Math.max(...pixels.map(pixel => pixel.alpha))).toBeLessThanOrEqual(0.72)
  })

  it('renders the same layered static field at every time under reduced motion', () => {
    const first = drawFrame(0, true)
    const later = drawFrame(10000, true)
    expect(later.pixels).toEqual(first.pixels)
    expect(first.pixels.some(pixel => pixel.size > 2.5 && pixel.alpha > 0.2)).toBe(true)
    expect(first.gradient.addColorStop.mock.calls).toEqual([
      [0, theme.blue],
      [0.5, theme.cyan],
      [1, theme.mint],
    ])
    expect(first.context.createLinearGradient).toHaveBeenCalledExactlyOnceWith(0, 0, 1120, 640)
  })

  it('keeps a viewport-sized buffer and bounded point count when zoomed out on a large display', () => {
    const large = { x: -1200, y: 350, zoom: 0.1, width: 8000, height: 5000 }
    const { canvas, pixels } = drawFrame(3200, false, large)
    expect(canvas.width).toBeLessThanOrEqual(16000)
    expect(canvas.height).toBeLessThanOrEqual(10000)
    expect(pixels.length).toBeLessThanOrEqual(6000)
    expect(pixels.every(pixel => Object.values(pixel).every(Number.isFinite))).toBe(true)
  })

  it.each([1, 0.5, 0.2, 0.08])('keeps background marks bounded at zoom %s', zoom => {
    const { pixels } = drawFrame(2400, false, { ...viewport, zoom })
    expect(pixels.length).toBeGreaterThan(500)
    expect(pixels.length).toBeLessThanOrEqual(6000)
    expect(pixels.every(pixel => pixel.size >= 1 && pixel.size <= (zoom <= 0.2 ? 1.8 : 4))).toBe(
      true,
    )
  })

  it('makes distant views sparse and fine while retaining moving ambience', () => {
    const near = drawFrame(2400)
    const distant = drawFrame(2400, false, { ...viewport, zoom: 0.08 })
    const ink = (frame: ReturnType<typeof drawFrame>) =>
      frame.pixels.reduce((sum, pixel) => sum + pixel.size ** 2 * pixel.alpha, 0)
    expect(ink(distant)).toBeLessThan(ink(near) * 0.2)
    expect(distant.pixels.length).toBeLessThan(near.pixels.length)
    expect(drawFrame(4000, false, { ...viewport, zoom: 0.08 }).pixels).not.toEqual(distant.pixels)
  })

  it('translates retained lattice points exactly with a pan instead of regenerating their positions', () => {
    const first = drawFrame(2400, true)
    const moved = drawFrame(2400, true, { ...viewport, x: 11, y: -7 })
    const centers = new Set(
      first.pixels.map(
        pixel =>
          `${(pixel.x + pixel.size / 2).toFixed(6)},${(pixel.y + pixel.size / 2).toFixed(6)}`,
      ),
    )
    const retained = moved.pixels.filter(pixel =>
      centers.has(
        `${(pixel.x + pixel.size / 2 - 11).toFixed(6)},${(pixel.y + pixel.size / 2 + 7).toFixed(6)}`,
      ),
    )
    expect(retained.length).toBeGreaterThan(moved.pixels.length * 0.95)
  })

  it('does not flash or reseed the visible field when crossing a grid level', () => {
    const ink = (zoom: number) =>
      drawFrame(2400, true, { ...viewport, zoom }).pixels.reduce(
        (sum, pixel) => sum + pixel.size ** 2 * pixel.alpha,
        0,
      )
    for (const zoom of [1, Math.SQRT2, 2]) {
      expect(Math.abs(ink(zoom - 1e-6) - ink(zoom + 1e-6)) / ink(zoom)).toBeLessThan(0.001)
    }
  })

  it('does not change node geometry while wave and terminal-edge pixels are drawn', () => {
    const node: PixelNode = Object.freeze({
      id: 'terminal',
      sessionId: 'session',
      rect: Object.freeze({ x: 100, y: 80, width: 420, height: 260 }),
      tone: 'working',
      acceptsOutput: true,
    })
    const before = structuredClone(node)
    drawFrame(0, false, viewport, [node])
    drawFrame(1600, false, viewport, [node])
    expect(node).toEqual(before)
  })
})
