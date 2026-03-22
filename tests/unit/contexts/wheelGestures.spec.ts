import { describe, expect, it } from 'vitest'
import {
  createCanvasInputModalityState,
  type WheelInputSample,
} from '../../../src/contexts/workspace/presentation/renderer/utils/inputModality'
import { resolveCanvasWheelGesture } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/wheelGestures'

function sample(overrides: Partial<WheelInputSample> = {}): WheelInputSample {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    timeStamp: 100,
    ...overrides,
  }
}

describe('canvas wheel gesture decisions', () => {
  it('zooms canvas on a strong mouse-wheel event in auto mode', () => {
    const decision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: 'trackpad',
      inputModalityState: createCanvasInputModalityState('trackpad'),
      trackpadGestureLock: null,
      wheelTarget: 'canvas',
      isTargetWithinCanvas: true,
      sample: sample({ deltaY: -120, timeStamp: 2400 }),
      lockTimestamp: 2400,
    })

    expect(decision.canvasAction).toBe('zoom')
    expect(decision.nextDetectedCanvasInputMode).toBe('mouse')
    expect(decision.nextTrackpadGestureLock).toBeNull()
  })

  it('zooms canvas on a noisy large mouse-wheel event after trackpad mode', () => {
    const decision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: 'trackpad',
      inputModalityState: createCanvasInputModalityState('trackpad'),
      trackpadGestureLock: null,
      wheelTarget: 'canvas',
      isTargetWithinCanvas: true,
      sample: sample({ deltaX: 2.5, deltaY: -96, timeStamp: 2416 }),
      lockTimestamp: 2416,
    })

    expect(decision.canvasAction).toBe('zoom')
    expect(decision.nextDetectedCanvasInputMode).toBe('mouse')
    expect(decision.nextTrackpadGestureLock).toBeNull()
  })

  it('pans canvas on a strong dual-axis gesture-like scroll in auto mode', () => {
    const decision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: 'mouse',
      inputModalityState: createCanvasInputModalityState('mouse'),
      trackpadGestureLock: null,
      wheelTarget: 'canvas',
      isTargetWithinCanvas: true,
      sample: sample({ deltaX: 6.5, deltaY: 9.25, timeStamp: 180 }),
      lockTimestamp: 180,
    })

    expect(decision.canvasAction).toBe('pan')
    expect(decision.nextDetectedCanvasInputMode).toBe('trackpad')
    expect(decision.nextTrackpadGestureLock).toMatchObject({
      action: 'pan',
      target: 'canvas',
    })
  })

  it('keeps mouse zoom on a single ambiguous vertical pixel wheel sample', () => {
    const decision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: 'mouse',
      inputModalityState: createCanvasInputModalityState('mouse'),
      trackpadGestureLock: null,
      wheelTarget: 'canvas',
      isTargetWithinCanvas: true,
      sample: sample({ deltaY: 4.5, timeStamp: 260 }),
      lockTimestamp: 260,
    })

    expect(decision.canvasAction).toBe('zoom')
    expect(decision.nextDetectedCanvasInputMode).toBe('mouse')
    expect(decision.nextInputModalityState.gestureLikeEventCount).toBe(0)
    expect(decision.nextTrackpadGestureLock).toBeNull()
  })

  it('keeps ambiguous vertical wheel bursts in mouse zoom mode', () => {
    const firstDecision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: 'mouse',
      inputModalityState: createCanvasInputModalityState('mouse'),
      trackpadGestureLock: null,
      wheelTarget: 'canvas',
      isTargetWithinCanvas: true,
      sample: sample({ deltaY: 4.5, timeStamp: 300 }),
      lockTimestamp: 300,
    })

    const secondDecision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: firstDecision.nextDetectedCanvasInputMode,
      inputModalityState: firstDecision.nextInputModalityState,
      trackpadGestureLock: firstDecision.nextTrackpadGestureLock,
      wheelTarget: 'canvas',
      isTargetWithinCanvas: true,
      sample: sample({ deltaY: 4.25, timeStamp: 316 }),
      lockTimestamp: 316,
    })

    expect(firstDecision.canvasAction).toBe('zoom')
    expect(secondDecision.canvasAction).toBe('zoom')
    expect(secondDecision.nextDetectedCanvasInputMode).toBe('mouse')
    expect(secondDecision.nextTrackpadGestureLock).toBeNull()
  })

  it('promotes repeated dual-axis gesture bursts to trackpad pan', () => {
    const firstDecision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: 'mouse',
      inputModalityState: createCanvasInputModalityState('mouse'),
      trackpadGestureLock: null,
      wheelTarget: 'canvas',
      isTargetWithinCanvas: true,
      sample: sample({ deltaX: 4, deltaY: 20, timeStamp: 300 }),
      lockTimestamp: 300,
    })

    const secondDecision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: firstDecision.nextDetectedCanvasInputMode,
      inputModalityState: firstDecision.nextInputModalityState,
      trackpadGestureLock: firstDecision.nextTrackpadGestureLock,
      wheelTarget: 'canvas',
      isTargetWithinCanvas: true,
      sample: sample({ deltaX: 5, deltaY: 20, timeStamp: 316 }),
      lockTimestamp: 316,
    })

    expect(firstDecision.canvasAction).toBe('zoom')
    expect(secondDecision.canvasAction).toBe('pan')
    expect(secondDecision.nextDetectedCanvasInputMode).toBe('trackpad')
    expect(secondDecision.nextTrackpadGestureLock).toMatchObject({
      action: 'pan',
      target: 'canvas',
    })
  })

  it('does not let child scrolling pollute canvas auto detection', () => {
    const decision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: 'trackpad',
      inputModalityState: createCanvasInputModalityState('trackpad'),
      trackpadGestureLock: null,
      wheelTarget: 'node',
      isTargetWithinCanvas: true,
      sample: sample({ deltaY: -120, timeStamp: 2200 }),
      lockTimestamp: 2200,
    })

    expect(decision.canvasAction).toBeNull()
    expect(decision.nextDetectedCanvasInputMode).toBe('trackpad')
    expect(decision.nextTrackpadGestureLock).toBeNull()
  })

  it('keeps a contiguous trackpad pan locked to the canvas across node hover', () => {
    const decision = resolveCanvasWheelGesture({
      canvasInputModeSetting: 'auto',
      resolvedCanvasInputMode: 'trackpad',
      inputModalityState: createCanvasInputModalityState('trackpad'),
      trackpadGestureLock: {
        action: 'pan',
        target: 'canvas',
        lastTimestamp: 100,
      },
      wheelTarget: 'node',
      isTargetWithinCanvas: true,
      sample: sample({ deltaX: 4.75, deltaY: 5.5, timeStamp: 180 }),
      lockTimestamp: 180,
    })

    expect(decision.canvasAction).toBe('pan')
    expect(decision.nextDetectedCanvasInputMode).toBe('trackpad')
    expect(decision.nextTrackpadGestureLock).toMatchObject({
      action: 'pan',
      target: 'canvas',
      lastTimestamp: 180,
    })
  })
})
