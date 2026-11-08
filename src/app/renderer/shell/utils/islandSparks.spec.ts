import { describe, expect, it } from 'vitest'
import { ISLAND_SPARK_COUNT, createIslandSparks } from './islandSparks'

const FROM = { left: 100, top: 10, width: 80, height: 24 }
const TO = { x: 60, y: 120 }
const COLORS = ['#a78bfa', '#f5c451']

/** With every draw at 0.5, each spark starts at the pill's centre and flies straight. */
const middle = () => 0.5

function drag(seconds: number): number {
  return (1 - Math.exp(-2.4 * seconds)) / 2.4
}

describe('island sparks', () => {
  it('sends 18 square sparks of whole pixels from the pill', () => {
    const sparks = createIslandSparks(middle)
    sparks.spawn({ from: FROM, to: TO, colors: COLORS, now: 0 })
    const sampled = sparks.sample(1_000)
    // None has been born yet at 0; at 1s every one of them has finished.
    expect(sampled).toEqual([])

    const live = createIslandSparks()
    live.spawn({ from: FROM, to: TO, colors: COLORS, now: 0 })
    const all = live.sample(200)
    expect(all).toHaveLength(ISLAND_SPARK_COUNT)
    for (const spark of all) {
      expect([3, 4]).toContain(spark.size)
      expect(COLORS).toContain(spark.color)
    }
  })

  it('flies on the canvas sparks’ drag and lands on the icon as it fades out', () => {
    const sparks = createIslandSparks(middle)
    sparks.spawn({ from: FROM, to: TO, colors: COLORS, now: 0 })
    expect(sparks.sample(0)).toEqual([])

    // Every draw at 0.5: born at 70ms, lives 660ms, no bow, no scatter.
    const start = { x: FROM.left + FROM.width / 2, y: FROM.top + FROM.height / 2 }
    const [atBirth] = sparks.sample(70)
    expect(atBirth).toMatchObject({ x: start.x, y: start.y, alpha: 1 })

    const half = 0.33
    const [midway] = sparks.sample(70 + 330)
    const progress = drag(half) / drag(0.66)
    expect(midway!.x).toBeCloseTo(start.x + (TO.x - start.x) * progress, 5)
    expect(midway!.y).toBeCloseTo(start.y + (TO.y - start.y) * progress, 5)
    expect(midway!.alpha).toBeCloseTo(0.5 ** 1.2, 5)

    const [landing] = sparks.sample(70 + 659)
    expect(landing!.x).toBeCloseTo(TO.x, 0)
    expect(landing!.y).toBeCloseTo(TO.y, 0)
    expect(landing!.alpha).toBeLessThan(0.01)
  })

  it('is idle before any spark and once the last one has landed', () => {
    const sparks = createIslandSparks()
    expect(sparks.isIdle(0)).toBe(true)
    sparks.spawn({ from: FROM, to: TO, colors: COLORS, now: 0 })
    expect(sparks.isIdle(0)).toBe(false)
    expect(sparks.isIdle(400)).toBe(false)
    expect(sparks.isIdle(1_000)).toBe(true)
    expect(sparks.sample(1_000)).toEqual([])
  })
})
