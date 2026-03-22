import { describe, expect, it } from 'vitest'
import {
  classifyCurrentWheelInputMode,
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
    expect(state.burstMode).toBe('trackpad')
    expect(state.gestureLikeEventCount).toBe(1)
  })

  it('switches to trackpad mode immediately on a strong dual-axis gesture sample', () => {
    const state = inferCanvasInputModalityFromWheel(createCanvasInputModalityState('mouse'), {
      deltaX: 1.2,
      deltaY: 2.1,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 200,
    })

    expect(state.mode).toBe('trackpad')
    expect(state.burstMode).toBe('trackpad')
  })

  it('keeps a single ambiguous vertical pixel wheel event in mouse mode', () => {
    const mode = classifyCurrentWheelInputMode(createCanvasInputModalityState('mouse'), {
      deltaX: 0,
      deltaY: 4.5,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 240,
    })

    expect(mode).toBe('unknown')

    const state = inferCanvasInputModalityFromWheel(createCanvasInputModalityState('mouse'), {
      deltaX: 0,
      deltaY: 4.5,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 240,
    })

    expect(state.mode).toBe('mouse')
    expect(state.gestureLikeEventCount).toBe(0)
    expect(state.burstMode).toBe('unknown')
  })

  it('keeps an ambiguous vertical burst in mouse mode', () => {
    const first = inferCanvasInputModalityFromWheel(createCanvasInputModalityState('mouse'), {
      deltaX: 0,
      deltaY: 4.5,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 300,
    })
    expect(first.mode).toBe('mouse')

    const second = inferCanvasInputModalityFromWheel(first, {
      deltaX: 0,
      deltaY: 4.25,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 316,
    })

    expect(second.mode).toBe('mouse')
    expect(second.burstMode).toBe('unknown')
    expect(second.gestureLikeEventCount).toBe(0)
  })

  it('promotes a repeated dual-axis gesture burst to trackpad mode', () => {
    const first = inferCanvasInputModalityFromWheel(createCanvasInputModalityState('mouse'), {
      deltaX: 4,
      deltaY: 20,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 360,
    })
    expect(first.gestureLikeEventCount).toBe(1)

    const second = inferCanvasInputModalityFromWheel(first, {
      deltaX: 5,
      deltaY: 20,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 376,
    })

    expect(second.mode).toBe('trackpad')
    expect(second.gestureLikeEventCount).toBe(2)
    expect(second.burstMode).toBe('trackpad')
  })

  it('keeps trackpad mode stable across ambiguous follow-up samples in the same burst', () => {
    const switched = inferCanvasInputModalityFromWheel(createCanvasInputModalityState('mouse'), {
      deltaX: 1.2,
      deltaY: 2.1,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 400,
    })
    expect(switched.mode).toBe('trackpad')

    const followUp = inferCanvasInputModalityFromWheel(switched, {
      deltaX: 0,
      deltaY: 3.5,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 416,
    })

    expect(followUp.mode).toBe('trackpad')
    expect(followUp.burstMode).toBe('trackpad')
  })

  it('restores mouse mode immediately on a high-confidence mouse wheel sample', () => {
    const trackpadState = inferCanvasInputModalityFromWheel(
      createCanvasInputModalityState('mouse'),
      {
        deltaX: 0,
        deltaY: 2,
        deltaMode: 0,
        ctrlKey: true,
        timeStamp: 500,
      },
    )
    expect(trackpadState.mode).toBe('trackpad')

    const mouseState = inferCanvasInputModalityFromWheel(trackpadState, {
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 516,
    })

    expect(mouseState.mode).toBe('mouse')
    expect(mouseState.burstMode).toBe('mouse')
    expect(mouseState.gestureLikeEventCount).toBe(0)
  })

  it('classifies large single-axis pixel wheel bursts as mouse input', () => {
    const mode = classifyCurrentWheelInputMode(createCanvasInputModalityState('trackpad'), {
      deltaX: 0,
      deltaY: 84,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 2400,
    })

    expect(mode).toBe('mouse')
  })

  it('keeps minor horizontal wheel noise from flipping large mouse zoom bursts to trackpad', () => {
    const mode = classifyCurrentWheelInputMode(createCanvasInputModalityState('trackpad'), {
      deltaX: 2.5,
      deltaY: 96,
      deltaMode: 0,
      ctrlKey: false,
      timeStamp: 2416,
    })

    expect(mode).toBe('mouse')
  })
})
