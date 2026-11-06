import { describe, expect, it, vi } from 'vitest'
import { drawWorkingPixels } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/workingRenderer'
import { projectPixelNodes } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/model'
import { pixelNode } from './workspacePixelLayer.fixtures'

const viewport = { x: 0, y: 0, zoom: 1, width: 1000, height: 800 }
const theme = { blue: 'blue', cyan: 'cyan', mint: 'green' }
const node = pixelNode({ kind: 'agent', status: 'running' })

function draw(now: number | null, nodes = [node], view = viewport) {
  const pixels: Array<{ x: number; y: number; size: number; alpha: number }> = []
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillRect(x: number, y: number, size: number) {
      pixels.push({ x, y, size, alpha: this.globalAlpha })
    },
  }
  const active = drawWorkingPixels(
    context as unknown as CanvasRenderingContext2D,
    projectPixelNodes(nodes, new Map(), view),
    view,
    theme,
    now,
  )
  return { pixels, active }
}

// The fixture window sits at x 100–400 on screen; the patrol runs just outside its frame.
function outsideFrame(
  pixel: { x: number; y: number; size: number },
  rect = projectPixelNodes([node], new Map(), viewport)[0]!.rect,
) {
  const cx = pixel.x + pixel.size / 2
  const cy = pixel.y + pixel.size / 2
  const inside = cx > rect.x && cx < rect.x + rect.width && cy > rect.y && cy < rect.y + rect.height
  const near =
    cx > rect.x - 16 &&
    cx < rect.x + rect.width + 16 &&
    cy > rect.y - 16 &&
    cy < rect.y + rect.height + 16
  return !inside && near
}

describe('Working Agent patrol', () => {
  it('sends two strings of pixels around the outside of the frame', () => {
    const before = structuredClone(node)
    const first = draw(0)
    const later = draw(700)
    expect(first.active).toBe(true)
    expect(first.pixels.length).toBeGreaterThanOrEqual(10)
    expect(first.pixels.every(pixel => outsideFrame(pixel))).toBe(true)
    // Two trains, on opposite sides of the frame.
    const xs = first.pixels.map(pixel => pixel.x)
    const ys = first.pixels.map(pixel => pixel.y)
    expect(Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(
      200,
    )
    expect(later.pixels).not.toEqual(first.pixels)
    // It goes all the way round: over the top and under the bottom, not only down the sides.
    const rect = projectPixelNodes([node], new Map(), viewport)[0]!.rect
    const over = Array.from({ length: 40 }, (_, step) => draw(step * 120).pixels).flat()
    expect(over.some(pixel => pixel.y + pixel.size <= rect.y)).toBe(true)
    expect(over.some(pixel => pixel.y >= rect.y + rect.height)).toBe(true)
    expect(node).toEqual(before)
  })

  it('holds a static frame highlight without a clock (reduced motion)', () => {
    const still = draw(null)
    expect(still.active).toBe(false)
    expect(still.pixels).toHaveLength(4)
    expect(still.pixels.every(pixel => pixel.alpha === 0.32)).toBe(true)
    expect(draw(null).pixels).toEqual(still.pixels)
  })

  it.each(['standby', 'waiting', 'failed', 'stopped', 'exited', 'restoring'] as const)(
    'does not patrol %s Agents or ordinary shells',
    status => {
      expect(draw(0, [pixelNode({ kind: 'agent', status })])).toEqual({ pixels: [], active: false })
      expect(draw(0, [pixelNode({ status: 'running' })]).active).toBe(false)
    },
  )

  it('draws only what is in view, even for oversized windows', () => {
    const huge = {
      ...node,
      position: { x: 100, y: -500000 },
      data: { ...node.data, height: 1000000 },
    }
    const frame = draw(1000, [huge])
    expect(frame.pixels.length).toBeLessThan(400)
    expect(frame.pixels.every(pixel => pixel.y >= -8 && pixel.y <= viewport.height + 8)).toBe(true)
    expect(draw(0, [{ ...node, position: { x: 2000, y: 0 } }]).pixels).toEqual([])
  })
})
