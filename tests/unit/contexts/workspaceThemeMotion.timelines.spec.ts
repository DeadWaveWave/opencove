import { describe, expect, it } from 'vitest'
import {
  createPixelAssembly,
  buildPixelAssemblyFrontier,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/assembly'
import {
  createPixelBurst,
  buildPixelBurstScene,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burst'

const frame = { id: 'node', sessionId: 'session', rect: { x: 0, y: 0, width: 300, height: 200 } }
const viewport = { x: 0, y: 0, zoom: 1, width: 1000, height: 800 }

describe('theme pixel timing', () => {
  it('keeps normalized reveal identical across configured durations and starts after readiness', () => {
    const short = createPixelAssembly(200)
    const long = createPixelAssembly(800)
    for (const timeline of [short, long]) {
      timeline.prepare(frame.id, 0)
      timeline.markReady(frame.id, 100)
    }
    const shortFrame = short.sample([frame], 200)[0]
    const longFrame = long.sample([frame], 500)[0]
    expect(buildPixelAssemblyFrontier(shortFrame)).toEqual(buildPixelAssemblyFrontier(longFrame))
    expect(short.sample([frame], 300)).toEqual([])
    expect(long.sample([frame], 899)).toHaveLength(1)
    expect(long.sample([frame], 900)).toEqual([])
  })

  it('retains geometric close snapshots for the requested duration without changing particle geometry', () => {
    const short = createPixelBurst(210)
    const long = createPixelBurst(840)
    for (const timeline of [short, long]) {
      timeline.announce(frame, viewport, 0)
    }
    expect(buildPixelBurstScene(short.sample(viewport, 105)[0])).toEqual(
      buildPixelBurstScene(long.sample(viewport, 420)[0]),
    )
    expect(short.hasPending(210)).toBe(false)
    expect(long.hasPending(839)).toBe(true)
    expect(long.hasPending(840)).toBe(false)
  })
})
