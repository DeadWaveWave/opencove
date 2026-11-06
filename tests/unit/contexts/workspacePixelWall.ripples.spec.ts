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
    expect(field.sample(1).map(wave => wave.key)).toEqual(
      Array.from({ length: 24 }, (_, i) => `w${i + 10}`),
    )
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
      expect(Math.abs(distance - ripple.radius)).toBeLessThanOrEqual(ripple.band * 2.5)
      expect(weight).toBeCloseTo(Math.exp(-(((distance - ripple.radius) / ripple.band) ** 2)), 10)
      expect(weight).toBeGreaterThan(0)
      expect(weight).toBeLessThanOrEqual(1)
    }
    // A full ring visits about its circumference × band in cells, not the whole disc.
    const ring = (2 * Math.PI * ripple.radius * 5 * ripple.band) / (24 * 24)
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

describe('Tide wave shapes', () => {
  it.each([
    ['output', 1100, 240, 30, 0.85],
    ['sonar', 1600, 200, 44, 0.45],
    ['beacon', 1300, 150, 28, 0.9],
    ['complete', 2100, 860, 56, 1],
    ['crest', 2100, 900, 22, 0.95],
    ['fail', 820, 190, 26, 0.95],
  ] as const)(
    '%s follows the prototype radius, amplitude and lifetime',
    (type, duration, reach, width, amp) => {
      const field = createRippleField()
      field.emit(`${type}:a`, { x: 100, y: 200 }, red, 1000, { type, initialRadius: 70 })
      for (const t of [0, 0.25, 0.5, 0.75, 0.99]) {
        const wave = field.sample(1000 + t * duration)[0]!
        expect(wave.radius).toBeCloseTo(70 + reach * (1 - (1 - t) ** 2.2), 10)
        expect(wave.strength).toBeCloseTo(amp * (1 - t) ** 1.5, 10)
        expect(wave.band).toBe(width)
      }
      expect(field.sample(1000 + duration)).toEqual([])
    },
  )

  it('keeps completion and crest when a full field receives a finished run', () => {
    const field = createRippleField()
    for (let i = 0; i < 24; i++) {
      field.emit(`w${i}`, { x: 0, y: 0 }, red, 0)
    }
    expect(field.ready('complete:a', 1)).toBe(true)
    field.emit('complete:a', { x: 0, y: 0 }, red, 1, { type: 'complete' })
    field.emit('crest:a', { x: 0, y: 0 }, [255, 255, 255], 1, { type: 'crest' })
    expect(field.sample(2).map(wave => wave.key)).toEqual([
      ...Array.from({ length: 22 }, (_, i) => `w${i + 2}`),
      'complete:a',
      'crest:a',
    ])
  })

  it('uses at least 0.8 world cells for the Gaussian width, visiting every eligible cell once', () => {
    const grid = { worldCell: 96, firstColumn: -3, firstRow: -3, columns: 8, rows: 8 }
    const wave = { x: 12, y: 12, radius: 160, band: 22 }
    const actual = new Map<string, number>()
    forEachRingCell(grid, wave, (column, row, weight) => {
      const key = `${column},${row}`
      expect(actual.has(key)).toBe(false)
      actual.set(key, weight)
    })
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.columns; col++) {
        const x = (Math.hypot((col - 2.5) * 96 - 12, (row - 2.5) * 96 - 12) - 160) / (0.8 * 96)
        if (Math.abs(x) <= 2.5) {
          expect(actual.get(`${col},${row}`)).toBeCloseTo(Math.exp(-x * x), 10)
        } else {
          expect(actual.has(`${col},${row}`)).toBe(false)
        }
      }
    }
  })
})

describe('sonar waves', () => {
  it('reports whether a key may send again, at its own interval', () => {
    const field = createRippleField()
    expect(field.ready('sonar:a', 0, 2400)).toBe(true)
    field.emit('sonar:a', { x: 0, y: 0 }, red, 0, { minIntervalMs: 2400, type: 'sonar' })
    expect(field.ready('sonar:a', 2399, 2400)).toBe(false)
    expect(field.emit('sonar:a', { x: 0, y: 0 }, red, 2399, { minIntervalMs: 2400 })).toBe(false)
    expect(field.ready('sonar:a', 2400, 2400)).toBe(true)
  })
})
