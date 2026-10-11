import { describe, expect, it, vi } from 'vitest'
import { createPixelFrameScheduler } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/scheduler'

function harness(draw = vi.fn(() => false)) {
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
  return { scheduler, draw, frames, tick, requestFrame, cancelFrame }
}

describe('pixel frame scheduler', () => {
  it('coalesces invalidations, draws static scenes once and caps active paints at 25fps', () => {
    const h = harness()
    for (let i = 0; i < 100; i++) {
      h.scheduler.invalidate()
    }
    expect(h.frames.size).toBe(1)
    h.tick(0)
    expect(h.draw).toHaveBeenCalledTimes(1)
    expect(h.frames.size).toBe(0)
    h.draw.mockReturnValue(true)
    h.scheduler.invalidate()
    for (let now = 1; now <= 120; now++) {
      h.tick(now)
    }
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0, 40, 80, 120])
    h.draw.mockReturnValue(false)
    h.tick(160)
    expect(h.frames.size).toBe(0)
  })

  it('starts a newly created window on the next pending frame, then restores the ambient cap', () => {
    const h = harness(vi.fn(() => true))
    h.scheduler.invalidate()
    h.tick(0)
    expect(h.frames.size).toBe(1)
    h.tick(16)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0])

    h.scheduler.invalidate({ immediate: true })
    h.scheduler.invalidate()
    expect(h.frames.size).toBe(1)
    h.tick(17)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0, 17])
    h.tick(32)
    h.tick(48)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0, 17])
    h.tick(57)
    expect(h.draw.mock.calls.map(call => call[0])).toEqual([0, 17, 57])
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
