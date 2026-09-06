import { describe, expect, it } from 'vitest'
import {
  PIXEL_BURST_MS,
  buildPixelBurstScene,
  createPixelBurst,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burst'

const viewport = { x: 20, y: 10, zoom: 2, width: 1200, height: 800 }
const node = {
  id: 'closed-node',
  sessionId: 'closed-session',
  rect: { x: 220, y: 170, width: 600, height: 400 },
}

describe('explicit node-close burst', () => {
  it('captures a copy in world coordinates and follows later pan and zoom after the node is gone', () => {
    const burst = createPixelBurst()
    const source = structuredClone(node)
    burst.announce(source, viewport, 100)
    source.rect.x = 999
    const moved = { ...viewport, x: -50, y: 40, zoom: 0.5 }
    expect(burst.sample(moved, 180)[0]).toMatchObject({
      id: node.id,
      sessionId: node.sessionId,
      age: 80,
      rect: { x: 0, y: 80, width: 150, height: 100 },
    })
    expect(viewport).toEqual({ x: 20, y: 10, zoom: 2, width: 1200, height: 800 })
  })

  it('expires from the close time even without sampling and never extends duplicate closes', () => {
    const burst = createPixelBurst()
    burst.announce(node, viewport, 100)
    burst.announce(node, viewport, 350)
    expect(burst.sample(viewport, 400)[0]?.age).toBe(300)
    expect(burst.sample(viewport, 100 + PIXEL_BURST_MS)).toEqual([])
    expect(burst.hasPending(100 + PIXEL_BURST_MS)).toBe(false)
    burst.announce(node, viewport, 1000)
    expect(burst.hasPending(1420)).toBe(false)
  })

  it('shows at most eight recent closes immediately and has no deferred overflow queue', () => {
    const burst = createPixelBurst()
    for (let index = 0; index < 20; index++) {
      burst.announce({ ...node, id: `closed-${index}` }, viewport, index)
    }
    const active = burst.sample(viewport, 40)
    expect(active.map(frame => frame.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `closed-${index + 12}`),
    )
    expect(active.every(frame => frame.age === 40 - Number(frame.id.slice(7)))).toBe(true)
    expect(burst.sample(viewport, 440)).toEqual([])
    expect(burst.hasPending(440)).toBe(false)
  })

  it('discards hidden/reduced-motion work when cleared and rejects unusable geometry', () => {
    const burst = createPixelBurst()
    burst.announce(node, viewport, 0)
    burst.clear()
    expect(burst.sample(viewport, 10)).toEqual([])
    expect(burst.hasPending(10)).toBe(false)
    burst.announce(node, { ...viewport, zoom: 0 }, 20)
    burst.announce({ ...node, rect: { ...node.rect, width: Number.NaN } }, viewport, 20)
    expect(burst.hasPending(20)).toBe(false)
  })

  it('does not restart a burst when its captured node leaves and reenters the viewport', () => {
    const burst = createPixelBurst()
    burst.announce(node, viewport, 0)
    expect(burst.sample({ ...viewport, x: -10000 }, 100)).toEqual([])
    expect(burst.sample(viewport, 300)[0]?.age).toBe(300)
    expect(burst.sample(viewport, 500)).toEqual([])
  })
})

describe('snappy pixel scatter scene', () => {
  const frameAt = (age: number) => {
    const burst = createPixelBurst()
    burst.announce(node, viewport, 0)
    return { ...burst.sample(viewport, 0)[0]!, age }
  }

  it('scatters a rectangular surface and its four edges without any ring or ellipse layer', () => {
    const initial = buildPixelBurstScene(frameAt(0))
    const snapped = buildPixelBurstScene(frameAt(90))
    expect(initial.particles.length).toBeGreaterThan(180)
    expect(snapped.particles).toHaveLength(initial.particles.length)
    const center = { x: node.rect.x + node.rect.width / 2, y: node.rect.y + node.rect.height / 2 }
    const meanDistance = (pixels: typeof initial.particles) =>
      pixels.reduce((sum, pixel) => sum + Math.hypot(pixel.x - center.x, pixel.y - center.y), 0) /
      pixels.length
    expect(meanDistance(snapped.particles) - meanDistance(initial.particles)).toBeGreaterThan(30)
    expect(snapped.particles.some(pixel => pixel.x < node.rect.x || pixel.x > 820)).toBe(true)
    expect(Object.keys(snapped)).toEqual(['particles'])
    expect(
      initial.particles.every(
        pixel =>
          pixel.x >= node.rect.x &&
          pixel.x <= node.rect.x + node.rect.width &&
          pixel.y >= node.rect.y &&
          pixel.y <= node.rect.y + node.rect.height,
      ),
    ).toBe(true)
    for (const x of [node.rect.x, node.rect.x + node.rect.width]) {
      expect(initial.particles.filter(pixel => pixel.x === x).length).toBeGreaterThan(5)
    }
    for (const y of [node.rect.y, node.rect.y + node.rect.height]) {
      expect(initial.particles.filter(pixel => pixel.y === y).length).toBeGreaterThan(5)
    }
  })

  it('keeps seed positions stable through viewport changes without changing particle count', () => {
    const burst = createPixelBurst()
    burst.announce(node, viewport, 0)
    const first = buildPixelBurstScene(burst.sample(viewport, 90)[0]!)
    const moved = { ...viewport, x: -50, y: 40, zoom: 0.5 }
    const next = buildPixelBurstScene(burst.sample(moved, 90)[0]!)
    expect(next.particles).toHaveLength(first.particles.length)
    first.particles.forEach((pixel, index) => {
      expect(next.particles[index]!.x).toBeCloseTo(
        ((pixel.x - viewport.x) / viewport.zoom) * moved.zoom + moved.x,
      )
      expect(next.particles[index]!.y).toBeCloseTo(
        ((pixel.y - viewport.y) / viewport.zoom) * moved.zoom + moved.y,
      )
    })
  })

  it('is deterministic, bounds drawing cost, and fades completely at 420ms', () => {
    const frame = frameAt(60)
    expect(buildPixelBurstScene(frame)).toEqual(buildPixelBurstScene(frame))
    const large = {
      ...frame,
      rect: { x: 0, y: 0, width: 8000, height: 5000 },
      sourceSize: { width: 8000, height: 5000 },
    }
    const scene = buildPixelBurstScene(large)
    expect(scene.particles.length).toBeLessThanOrEqual(256)
    expect(Object.keys(scene)).toEqual(['particles'])
    expect(scene.particles.every(pixel => pixel.alpha >= 0 && pixel.alpha <= 1)).toBe(true)
    expect(
      Math.max(...buildPixelBurstScene(frameAt(400)).particles.map(pixel => pixel.alpha)),
    ).toBeLessThan(0.03)
    expect(buildPixelBurstScene(frameAt(420))).toEqual({ particles: [] })
  })
})
