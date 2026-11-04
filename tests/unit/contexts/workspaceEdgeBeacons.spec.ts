import { describe, expect, it } from 'vitest'
import {
  EDGE_BEACON_LIMIT,
  resolveEdgeBeacons,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/edgeBeacons'

const viewport = { width: 1000, height: 600 }
const inset = { x: 120, y: 24 }
const window = (id: string, x: number, y: number) => ({
  id,
  title: id,
  rect: { x, y, width: 200, height: 120 },
})

describe('edge beacons', () => {
  it('points at waiting windows that are entirely out of view, and ignores visible ones', () => {
    const { beacons, overflow } = resolveEdgeBeacons(
      [window('right', 1600, 240), window('visible', 300, 200), window('edge', 950, 200)],
      viewport,
      inset,
    )
    expect(beacons.map(beacon => beacon.id)).toEqual(['right'])
    expect(beacons[0]).toMatchObject({ side: 'right', x: 1000 - inset.x })
    expect(beacons[0]!.y).toBeGreaterThan(inset.y)
    expect(beacons[0]!.y).toBeLessThan(600 - inset.y)
    expect(overflow).toBeNull()
  })

  it('places each beacon where the line from the centre to the window meets the edge', () => {
    const { beacons } = resolveEdgeBeacons(
      [window('above', 400, -900), window('left', -2000, 240), window('corner', 3000, 3000)],
      viewport,
      inset,
    )
    const byId = Object.fromEntries(beacons.map(beacon => [beacon.id, beacon]))
    expect(byId.above).toMatchObject({ side: 'top', y: inset.y })
    expect(byId.left).toMatchObject({ side: 'left', x: inset.x })
    // Far down and right: the bottom-right corner of the inset frame.
    expect(byId.corner!.x).toBeLessThanOrEqual(1000 - inset.x)
    expect(byId.corner!.y).toBeLessThanOrEqual(600 - inset.y)
    expect(byId.corner!.x).toBeGreaterThan(700)
    expect(byId.corner!.y).toBeGreaterThan(400)
  })

  it('shows the five nearest and folds the rest into +N', () => {
    const windows = Array.from({ length: 8 }, (_, index) =>
      window(`w${index}`, 1200 + index * 400, 240),
    )
    const { beacons, overflow } = resolveEdgeBeacons(windows, viewport, inset)
    expect(beacons).toHaveLength(EDGE_BEACON_LIMIT)
    expect(beacons.map(beacon => beacon.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4'])
    expect(overflow).toMatchObject({ count: 3, ids: ['w5', 'w6', 'w7'] })
  })

  it('shows nothing when no waiting window is out of view', () => {
    expect(resolveEdgeBeacons([window('a', 100, 100)], viewport, inset)).toEqual({
      beacons: [],
      overflow: null,
    })
  })
})
