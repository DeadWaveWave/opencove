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
  violet: '#a980f4',
  blue: '#63a9ec',
  mint: '#63e9c3',
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

  it('retains visible two-to-seven-pixel ridges instead of a uniform faint dot grid', () => {
    const { pixels } = drawFrame(2400)
    expect(Math.min(...pixels.map(pixel => pixel.size))).toBeGreaterThanOrEqual(2)
    expect(Math.max(...pixels.map(pixel => pixel.size))).toBeGreaterThan(6)
    expect(Math.max(...pixels.map(pixel => pixel.size))).toBeLessThanOrEqual(7)
    expect(pixels.filter(pixel => pixel.size > 4 && pixel.alpha > 0.18).length).toBeGreaterThan(100)
    expect(Math.max(...pixels.map(pixel => pixel.alpha))).toBeLessThanOrEqual(0.72)
  })

  it('renders the same layered static field at every time under reduced motion', () => {
    const first = drawFrame(0, true)
    const later = drawFrame(10000, true)
    expect(later.pixels).toEqual(first.pixels)
    expect(first.pixels.some(pixel => pixel.size > 5 && pixel.alpha > 0.2)).toBe(true)
    expect(first.gradient.addColorStop.mock.calls).toEqual([
      [0, theme.violet],
      [0.5, theme.blue],
      [1, theme.mint],
    ])
    expect(first.context.createLinearGradient).toHaveBeenCalledExactlyOnceWith(0, 0, 1120, 640)
  })

  it('keeps a viewport-sized buffer and bounded point count when zoomed out on a large display', () => {
    const large = { x: -1200, y: 350, zoom: 0.1, width: 8000, height: 5000 }
    const { canvas, pixels } = drawFrame(3200, false, large)
    expect(canvas.width).toBeLessThanOrEqual(16000)
    expect(canvas.height).toBeLessThanOrEqual(10000)
    expect(pixels.length).toBeLessThan(17500)
    expect(pixels.every(pixel => Object.values(pixel).every(Number.isFinite))).toBe(true)
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
