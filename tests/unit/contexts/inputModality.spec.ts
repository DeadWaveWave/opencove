import { describe, expect, it } from 'vitest'
import {
  createCanvasInputModalityState,
  inferCanvasInputModalityFromWheel,
} from '../../../src/contexts/workspace/presentation/renderer/utils/inputModality'

describe('canvas input modality inference', () => {
  it('switches to trackpad mode on pinch-style wheel gestures', () => {
    const state = inferCanvasInputModalityFromWheel(createCanvasInputModalityState('mouse'), {
      deltaX: 0,
      deltaY: 2,
      deltaMode: 0,
      ctrlKey: true,
      timeStamp: 100,
    })

    expect(state.mode).toBe('trackpad')
    expect(state.score).toBeGreaterThanOrEqual(4)
  })

  it('switches back to mouse mode only after enough mouse evidence', () => {
    const trackpadState = createCanvasInputModalityState('trackpad')

    const afterFirstLineStep = inferCanvasInputModalityFromWheel(trackpadState, {
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      ctrlKey: false,
      timeStamp: 120,
    })
    expect(afterFirstLineStep.mode).toBe('trackpad')

    const afterSecondLineStep = inferCanvasInputModalityFromWheel(afterFirstLineStep, {
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      ctrlKey: false,
      timeStamp: 140,
    })
    expect(afterSecondLineStep.mode).toBe('mouse')
    expect(afterSecondLineStep.score).toBeLessThanOrEqual(-4)
  })

  it('treats dense dual-axis pixel scrolling as trackpad input', () => {
    const initial = createCanvasInputModalityState('mouse')

    const afterFirstEvent = inferCanvasInputModalityFromWheel(initial, {
      deltaX: 1.2,
      deltaY: 2.1,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 200,
    })
    expect(afterFirstEvent.mode).toBe('mouse')

    const afterSecondEvent = inferCanvasInputModalityFromWheel(afterFirstEvent, {
      deltaX: 0.9,
      deltaY: 1.7,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 212,
    })
    expect(afterSecondEvent.mode).toBe('trackpad')
  })

  it('decays stale confidence before the next event', () => {
    const first = inferCanvasInputModalityFromWheel(createCanvasInputModalityState('mouse'), {
      deltaX: 0,
      deltaY: 2,
      deltaMode: 0,
      ctrlKey: true,
      timeStamp: 300,
    })
    expect(first.mode).toBe('trackpad')

    const second = inferCanvasInputModalityFromWheel(first, {
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      ctrlKey: false,
      timeStamp: 2100,
    })

    expect(second.score).toBeLessThan(first.score)
  })

  it('keeps trackpad mode stable across short opposite-wheel bursts', () => {
    const switched = inferCanvasInputModalityFromWheel(createCanvasInputModalityState('mouse'), {
      deltaX: 0,
      deltaY: 2,
      deltaMode: 0,
      ctrlKey: true,
      timeStamp: 100,
    })
    expect(switched.mode).toBe('trackpad')

    const firstOpposite = inferCanvasInputModalityFromWheel(switched, {
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      ctrlKey: false,
      timeStamp: 140,
    })
    expect(firstOpposite.mode).toBe('trackpad')

    const secondOpposite = inferCanvasInputModalityFromWheel(firstOpposite, {
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      ctrlKey: false,
      timeStamp: 170,
    })
    expect(secondOpposite.mode).toBe('trackpad')
  })
})
