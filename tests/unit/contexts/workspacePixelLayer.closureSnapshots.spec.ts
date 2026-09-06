import { describe, expect, it } from 'vitest'
import { createPixelClosureSnapshots } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/closureSnapshots'

const viewport = { x: 40, y: 20, zoom: 2, width: 1000, height: 800 }
const frame = {
  id: 'node-1',
  sessionId: 'session-1',
  rect: { x: 240, y: 180, width: 400, height: 200 },
}

describe('pixel closure geometry handoff', () => {
  it('retains geometry briefly across synchronous removal and consumes it only once', () => {
    const snapshots = createPixelClosureSnapshots()
    snapshots.capture([frame], viewport, 0)
    snapshots.capture([], viewport, 1000)
    snapshots.capture([], viewport, 1040)
    expect(snapshots.take(frame.id, viewport, 1050)).toEqual(frame)
    expect(snapshots.take(frame.id, viewport, 1050)).toBeNull()
  })

  it('projects the last visible world rectangle using the current viewport', () => {
    const snapshots = createPixelClosureSnapshots()
    snapshots.capture([frame], viewport, 0)
    snapshots.capture([], viewport, 100)
    expect(snapshots.take(frame.id, { ...viewport, x: 0, y: 0, zoom: 1 }, 110)?.rect).toEqual({
      x: 100,
      y: 80,
      width: 200,
      height: 100,
    })
  })

  it('expires removed geometry without renewing it on subsequent updates', () => {
    const snapshots = createPixelClosureSnapshots()
    snapshots.capture([frame], viewport, 0)
    snapshots.capture([], viewport, 1000)
    snapshots.capture([], viewport, 1100)
    expect(snapshots.take(frame.id, viewport, 1200)).toBeNull()
    expect(snapshots.take('unknown', viewport, 1200)).toBeNull()
  })

  it('immediately forgets an existing node that becomes filtered or hidden', () => {
    const snapshots = createPixelClosureSnapshots()
    snapshots.capture([frame], viewport, 0)
    snapshots.capture([], viewport, 100, new Set([frame.id]))
    expect(snapshots.take(frame.id, viewport, 101)).toBeNull()
  })

  it('bounds retained geometry and clears it on visibility or theme lifecycle changes', () => {
    const snapshots = createPixelClosureSnapshots()
    snapshots.capture(
      Array.from({ length: 2000 }, (_, index) => ({ ...frame, id: `node-${index}` })),
      viewport,
      0,
    )
    const retained = Array.from({ length: 2000 }, (_, index) =>
      snapshots.take(`node-${index}`, viewport, 0),
    ).filter(Boolean)
    expect(retained.length).toBeLessThanOrEqual(256)
    snapshots.capture([frame], viewport, 100)
    snapshots.clear()
    expect(snapshots.take(frame.id, viewport, 100)).toBeNull()
  })
})
