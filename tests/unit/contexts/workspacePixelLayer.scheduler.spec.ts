import { describe, expect, it, vi } from 'vitest'
import {
  createPixelFrameScheduler,
  PIXEL_FRAME_RATE,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/scheduler'

function harness(draw = vi.fn((_now: number) => false)) {
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 0
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextId, callback)
    return nextId
  })
  const cancelFrame = vi.fn((id: number) => {
    frames.delete(id)
  })
  const scheduler = createPixelFrameScheduler({ draw, requestFrame, cancelFrame })
  const tick = (now: number) => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(now))
  }
  /** Runs the display at `hz` from `from` for `ms`, like a real vsync. */
  const run = (hz: number, from: number, ms: number) => {
    const step = 1000 / hz
    for (let now = from; now < from + ms; now += step) {
      tick(now)
    }
  }
  return { scheduler, draw, frames, tick, run, requestFrame, cancelFrame }
}

describe('pixel frame scheduler', () => {
  it('coalesces invalidations and draws a static scene once', () => {
    const h = harness()
    for (let i = 0; i < 100; i++) {
      h.scheduler.invalidate()
    }
    expect(h.frames.size).toBe(1)
    h.tick(0)
    expect(h.draw).toHaveBeenCalledTimes(1)
    expect(h.frames.size).toBe(0)
  })

  it.each([60, 120, 144])(
    'paints 30 frames a second on a %iHz display, not a quantised rate',
    hz => {
      const h = harness(vi.fn(() => true))
      h.scheduler.invalidate()
      h.run(hz, 0, 2000)
      // Skipping frames that are "too early" quantises to 24fps at 120Hz; an accumulator does not.
      expect(h.draw.mock.calls.length).toBeGreaterThanOrEqual(2 * PIXEL_FRAME_RATE.focused - 1)
      expect(h.draw.mock.calls.length).toBeLessThanOrEqual(2 * PIXEL_FRAME_RATE.focused + 1)
    },
  )

  it('slows to 10 frames a second while the window is not focused, and recovers', () => {
    const h = harness(vi.fn(() => true))
    h.scheduler.invalidate()
    h.scheduler.setFocused(false)
    h.run(120, 0, 1000)
    expect(h.draw.mock.calls.length).toBeGreaterThanOrEqual(PIXEL_FRAME_RATE.unfocused - 1)
    expect(h.draw.mock.calls.length).toBeLessThanOrEqual(PIXEL_FRAME_RATE.unfocused + 1)
    h.draw.mockClear()
    h.scheduler.setFocused(true)
    h.run(120, 1000, 1000)
    expect(h.draw.mock.calls.length).toBeGreaterThanOrEqual(PIXEL_FRAME_RATE.focused - 1)
  })

  it('never banks time: a long stall paints once, not a burst', () => {
    const h = harness(vi.fn(() => true))
    h.scheduler.invalidate()
    h.tick(0)
    h.tick(500)
    h.tick(508)
    h.tick(516)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0, 500])
  })

  it('paints an immediate invalidation on the next frame, then restores the cap', () => {
    const h = harness(vi.fn(() => true))
    h.scheduler.invalidate()
    h.tick(0)
    h.tick(8)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0])
    h.scheduler.invalidate({ immediate: true })
    h.tick(16)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0, 16])
    h.tick(24)
    h.tick(32)
    h.tick(40)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0, 16])
    h.tick(50)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0, 16, 50])
  })

  it('starts fresh after going idle, so the next change paints at once', () => {
    const h = harness(vi.fn(() => false))
    h.scheduler.invalidate()
    h.tick(0)
    h.scheduler.invalidate()
    h.tick(5)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0, 5])
  })

  it('cancels pending work while hidden and cannot schedule after dispose', () => {
    const h = harness(vi.fn(() => true))
    h.scheduler.invalidate()
    h.scheduler.setVisible(false)
    expect(h.frames.size).toBe(0)
    h.scheduler.invalidate()
    expect(h.frames.size).toBe(0)
    h.scheduler.setVisible(true)
    expect(h.frames.size).toBe(1)
    h.scheduler.dispose()
    h.scheduler.invalidate()
    h.scheduler.setVisible(true)
    expect(h.frames.size).toBe(0)
    expect(h.draw).not.toHaveBeenCalled()
  })
})
