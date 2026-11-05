import { describe, expect, it } from 'vitest'
import {
  createRippleField,
  forEachRingCell,
  RIPPLE_DURATION_MS,
  RIPPLE_LIMIT,
  RIPPLE_WINDOW_INTERVAL_MS,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/ripples'

const red = [255, 0, 0] as const

describe('output ripples', () => {
  it('starts one ripple per window at most every 700ms', () => {
    const field = createRippleField()
    expect(field.emit('a', { x: 0, y: 0 }, red, 0)).toBe(true)
    expect(field.emit('a', { x: 0, y: 0 }, red, RIPPLE_WINDOW_INTERVAL_MS - 1)).toBe(false)
    expect(field.emit('b', { x: 0, y: 0 }, red, 10)).toBe(true)
    expect(field.emit('a', { x: 0, y: 0 }, red, RIPPLE_WINDOW_INTERVAL_MS)).toBe(true)
    expect(field.sample(RIPPLE_WINDOW_INTERVAL_MS)).toHaveLength(3)
  })

  it('keeps at most 24 ripples on the canvas at once', () => {
    const field = createRippleField()
    for (let index = 0; index < RIPPLE_LIMIT + 10; index++) {
      field.emit(`w${index}`, { x: index, y: 0 }, red, 0)
    }
    expect(field.sample(1)).toHaveLength(RIPPLE_LIMIT)
  })

  it('grows each ripple outward, fades it, and forgets it after about a second', () => {
    const field = createRippleField()
    field.emit('a', { x: 100, y: 50 }, red, 1000)
    const early = field.sample(1100)[0]!
    const late = field.sample(1700)[0]!
    expect(late.radius).toBeGreaterThan(early.radius)
    expect(late.strength).toBeLessThan(early.strength)
    expect(early).toMatchObject({ x: 100, y: 50, color: red })
    expect(field.sample(1000 + RIPPLE_DURATION_MS + 1)).toEqual([])
    expect(field.active(1000 + RIPPLE_DURATION_MS + 1)).toBe(false)
  })

  it('touches only the cells in the ring band', () => {
    const grid = { worldCell: 24, firstColumn: 0, firstRow: 0, columns: 100, rows: 100 }
    const ripple = { x: 1200, y: 1200, radius: 480, band: 48 }
    const visited: Array<[number, number, number]> = []
    forEachRingCell(grid, ripple, (column, row, weight) => visited.push([column, row, weight]))
    expect(visited.length).toBeGreaterThan(100)
    for (const [column, row, weight] of visited) {
      const cx = (column + 0.5) * 24
      const cy = (row + 0.5) * 24
      const distance = Math.hypot(cx - ripple.x, cy - ripple.y)
      expect(Math.abs(distance - ripple.radius)).toBeLessThanOrEqual(ripple.band)
      expect(weight).toBeGreaterThan(0)
      expect(weight).toBeLessThanOrEqual(1)
    }
    // A full ring visits about its circumference × band in cells, not the whole disc.
    const ring = (2 * Math.PI * ripple.radius * 2 * ripple.band) / (24 * 24)
    expect(visited.length).toBeLessThan(ring * 1.4)
  })

  it('clips the ring to the visible grid', () => {
    const grid = { worldCell: 24, firstColumn: 10, firstRow: 10, columns: 5, rows: 5 }
    const visited: Array<[number, number]> = []
    forEachRingCell(grid, { x: 300, y: 300, radius: 40, band: 24 }, (column, row) =>
      visited.push([column, row]),
    )
    for (const [column, row] of visited) {
      expect(column).toBeGreaterThanOrEqual(0)
      expect(column).toBeLessThan(5)
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThan(5)
    }
  })
})

describe('signal waves', () => {
  it('lets a wave set its own reach, duration and strength, outside the output throttle', () => {
    const field = createRippleField()
    field.emit('a', { x: 0, y: 0 }, red, 0)
    expect(
      field.emit('complete:a', { x: 0, y: 0 }, red, 10, {
        reach: 1400,
        durationMs: 1600,
        gain: 0.85,
        crest: true,
      }),
    ).toBe(true)
    // The output ripple is over by now; the wave carries on.
    const waves = field.sample(1200)
    expect(waves).toHaveLength(1)
    const [wave] = waves
    expect(wave).toMatchObject({ gain: 0.85, crest: true })
    // Still alive after an output ripple's second, and travelling further.
    expect(wave!.radius).toBeGreaterThan(640)
    expect(field.sample(1700)).toHaveLength(0)
  })
})
