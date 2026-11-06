import { describe, expect, it, vi } from 'vitest'
import { createRippleField } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/ripples'
import {
  drawDotRipples,
  emitOutputRipple,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/dotRipples'

function recorder() {
  const rects: Array<{ x: number; y: number; size: number; alpha: number }> = []
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    fillRect: vi.fn(function (this: { globalAlpha: number }, x: number, y: number, size: number) {
      rects.push({ x, y, size, alpha: this.globalAlpha })
    }),
  }
  return { context: context as unknown as CanvasRenderingContext2D, rects }
}

describe('dot ripples on the minimal background', () => {
  const viewport = { x: 0, y: 0, zoom: 1, width: 1200, height: 900 }
  const ripple = { x: 600, y: 456, radius: 240, band: 36, strength: 1, color: [0, 200, 0] as const }

  it('lights only the dots on the wavefront, centred on the dot lattice', () => {
    const { context, rects } = recorder()
    expect(drawDotRipples(context, viewport, [ripple])).toBe(rects.length)
    expect(rects.length).toBeGreaterThan(20)
    for (const rect of rects) {
      const cx = rect.x + rect.size / 2
      const cy = rect.y + rect.size / 2
      // Every mark sits on a dot of the 24 px grid…
      expect(Math.abs(cx / 24 - Math.round(cx / 24))).toBeLessThan(1e-6)
      expect(Math.abs(cy / 24 - Math.round(cy / 24))).toBeLessThan(1e-6)
      // …within the band around the wavefront.
      expect(
        Math.abs(Math.hypot(cx - ripple.x, cy - ripple.y) - ripple.radius),
      ).toBeLessThanOrEqual(ripple.band + 1)
    }
  })

  it('follows the canvas pan and zoom', () => {
    const { context, rects } = recorder()
    drawDotRipples(context, { ...viewport, x: 50, y: -30, zoom: 0.5 }, [ripple])
    const cx = rects.map(rect => rect.x + rect.size / 2)
    const mean = cx.reduce((sum, value) => sum + value, 0) / cx.length
    expect(mean).toBeCloseTo(ripple.x * 0.5 + 50, -1)
  })

  it('draws nothing without ripples', () => {
    const { context, rects } = recorder()
    expect(drawDotRipples(context, viewport, [])).toBe(0)
    expect(rects).toEqual([])
  })
})

describe('dot output signal authority', () => {
  it('ignores an agent repaint stream but ripples for plain terminal output', () => {
    const field = createRippleField()
    const nodes = [
      { id: 'agent', data: { kind: 'agent', status: 'running' } },
      { id: 'terminal', data: { kind: 'terminal', status: null } },
    ]
    const projected = nodes.map(node => ({
      id: node.id,
      sessionId: node.id,
      acceptsOutput: true,
      tone: null,
      rect: { x: 0, y: 0, width: 300, height: 200 },
    }))
    const seen = new Set<string | undefined>()
    for (let now = 0; now <= 3040; now += 80) {
      for (const node of nodes) {
        emitOutputRipple(
          field,
          node.id,
          projected,
          nodes as never,
          { x: 0, y: 0, zoom: 1, width: 1200, height: 900 },
          document.body,
          now,
        )
      }
      field.sample(now).forEach(wave => seen.add(wave.key))
    }
    expect([...seen]).toEqual(['terminal'])
  })
})
