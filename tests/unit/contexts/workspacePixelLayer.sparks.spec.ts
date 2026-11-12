import { describe, expect, it, vi } from 'vitest'
import {
  createPixelSparks,
  drawPixelSparks,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/sparks'

const rect = { x: 100, y: 80, width: 300, height: 200 }
const viewport = { x: 0, y: 0, zoom: 1, width: 1000, height: 800 }

describe('Tide canvas sparks', () => {
  it.each([
    ['lod', 10, 40, 260, 0],
    ['complete', 26, 260, 700, 0],
    ['fail', 14, 150, 560, 320],
  ] as const)(
    'spawns %s particles with the prototype count, speed, life and gravity',
    (kind, count, speed, life, gravity) => {
      const sparks = createPixelSparks(() => 0.5)
      sparks.spawn(kind, rect, '#123456', 100)
      const start = sparks.sample(100)
      expect(start).toHaveLength(count)
      // Random .5 selects the bottom-right corner; speed multiplier and life multiplier are 1.
      expect(start[0]).toMatchObject({ x: 400, y: 280, size: 3.25, alpha: 1, color: '#123456' })
      const sec = 0.1
      const distance = (1 - Math.exp(-2.4 * sec)) / 2.4
      const later = sparks.sample(200)[0]
      expect(later.x).toBeCloseTo(400 + (150 / Math.hypot(150, 100)) * speed * distance)
      expect(later.y).toBeCloseTo(
        280 + (100 / Math.hypot(150, 100)) * speed * distance + 0.5 * gravity * sec ** 2,
      )
      expect(later.alpha).toBeCloseTo((1 - 100 / life) ** 1.2)
      expect(sparks.sample(100 + life)).toEqual([])
    },
  )

  it.each([0.3, 1, 2])('scales spark sizes by clamp(zoom, .55, 1.2) and snaps at zoom %s', zoom => {
    const field = createPixelSparks(() => 0.5)
    field.spawn('complete', rect, 'purple', 0)
    const context = { fillRect: vi.fn(), fillStyle: '', globalAlpha: 1 }
    drawPixelSparks(
      context as unknown as CanvasRenderingContext2D,
      field.sample(100),
      { ...viewport, zoom },
      2,
    )
    expect(context.fillRect).toHaveBeenCalledTimes(26)
    const [x, y, w, h] = context.fillRect.mock.calls[0]
    expect(w).toBe(3.25 * Math.max(0.55, Math.min(1.2, zoom)))
    expect(h).toBe(w)
    expect(x * 2).toBe(Math.round(x * 2))
    expect(y * 2).toBe(Math.round(y * 2))
    expect(context.fillStyle).toBe('purple')
    expect(context.globalAlpha).toBe(1)
  })

  it('bounds the field to 1200 newest particles and clears all activity', () => {
    const field = createPixelSparks(() => 0.5)
    field.spawn('complete', rect, 'old', 0)
    for (let i = 0; i < 120; i++) {
      field.spawn('lod', rect, 'new', 10)
    }
    const samples = field.sample(10)
    expect(samples).toHaveLength(1200)
    expect(samples.every(p => p.color === 'new')).toBe(true)
    field.clear()
    expect(field.sample(10)).toEqual([])
  })
})
