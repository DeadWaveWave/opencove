import { describe, expect, it, vi } from 'vitest'
import { drawWorkingPixels } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/workingRenderer'
import { projectPixelNodes } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/model'
import { pixelNode } from './workspacePixelLayer.fixtures'

const viewport = { x: 0, y: 0, zoom: 1, width: 1000, height: 800 }
const theme = { blue: 'blue', cyan: 'cyan', mint: 'green' }
const node = pixelNode({ kind: 'agent', status: 'running' })

function draw(now: number, nodes = [node], view = viewport) {
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

describe('Working Agent pixel rims', () => {
  it('flows on both outside edges without output events or geometry changes', () => {
    const before = structuredClone(node)
    const first = draw(0)
    const later = draw(1400)
    expect(first.active).toBe(true)
    expect(first.pixels.some(pixel => pixel.x < 100)).toBe(true)
    expect(first.pixels.some(pixel => pixel.x > 400)).toBe(true)
    expect(first.pixels.every(pixel => pixel.x + pixel.size <= 100 || pixel.x >= 400)).toBe(true)
    expect(later.pixels).not.toEqual(first.pixels)
    expect(node).toEqual(before)
  })

  it.each(['standby', 'waiting', 'failed', 'stopped', 'exited', 'restoring'] as const)(
    'does not animate %s Agents or ordinary shells',
    status => {
      expect(draw(0, [pixelNode({ kind: 'agent', status })])).toEqual({ pixels: [], active: false })
      expect(draw(0, [pixelNode({ status: 'running' })]).active).toBe(false)
    },
  )

  it('bounds work to the visible edges of oversized windows', () => {
    const huge = {
      ...node,
      position: { x: 100, y: -500000 },
      data: { ...node.data, height: 1000000 },
    }
    const frame = draw(1000, [huge])
    expect(frame.pixels.length).toBeLessThan(400)
    expect(frame.pixels.every(pixel => pixel.y >= -4 && pixel.y <= viewport.height + 4)).toBe(true)
    expect(draw(0, [{ ...node, position: { x: 2000, y: 0 } }]).active).toBe(false)
  })
})
