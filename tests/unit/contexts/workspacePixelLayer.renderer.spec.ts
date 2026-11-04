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

describe('pixel effects layer', () => {
  it('paints no ambient background: the pixel wall owns it', () => {
    expect(drawFrame(0).pixels).toEqual([])
    expect(drawFrame(1600).pixels).toEqual([])
    expect(drawFrame(0, true).pixels).toEqual([])
  })

  it('marks only the corners of a node with a status tone while it receives no output', () => {
    const node: PixelNode = {
      id: 'terminal',
      sessionId: 'session',
      rect: { x: 100, y: 80, width: 420, height: 260 },
      tone: 'warning',
      acceptsOutput: true,
    }
    const { pixels } = drawFrame(0, false, viewport, [node])
    // Four sides × four corner marks, outside the frame.
    expect(pixels).toHaveLength(16)
    for (const pixel of pixels) {
      const inside =
        pixel.x > node.rect.x &&
        pixel.x < node.rect.x + node.rect.width &&
        pixel.y > node.rect.y &&
        pixel.y < node.rect.y + node.rect.height
      expect(inside).toBe(false)
    }
  })

  it('does not change node geometry while terminal-edge pixels are drawn', () => {
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
