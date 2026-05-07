import { describe, expect, it, vi } from 'vitest'
import { createCommittedScreenStateRecorder } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/committedScreenState'

function createSerializeAddon() {
  let count = 0
  return {
    serialize: vi.fn(() => {
      count += 1
      return `SCREEN_${count}`
    }),
  }
}

function createTerminal(bufferType: 'normal' | 'alternate' = 'normal') {
  return {
    cols: 80,
    rows: 24,
    buffer: {
      active: {
        type: bufferType,
      },
    },
  }
}

describe('committed terminal screen state recorder', () => {
  it('captures the baseline and first live update before applying sustained-output throttling', () => {
    const serializeAddon = createSerializeAddon()
    const recorder = createCommittedScreenStateRecorder({
      serializeAddon: serializeAddon as never,
      sessionId: 'session-baseline-live',
      terminal: createTerminal() as never,
      now: () => 0,
    })

    recorder.record('RAW_BASELINE')
    recorder.record('RAW_FIRST_LIVE')
    recorder.record('RAW_SECOND_LIVE')

    expect(serializeAddon.serialize).toHaveBeenCalledTimes(2)
    expect(recorder.resolve('RAW_SECOND_LIVE', { allowSerializeFallback: false })).toEqual(
      expect.objectContaining({
        rawSnapshot: 'RAW_FIRST_LIVE',
        serialized: 'SCREEN_2',
      }),
    )
  })

  it('throttles committed screen serialization during sustained output', () => {
    let currentTime = 0
    const serializeAddon = createSerializeAddon()
    const recorder = createCommittedScreenStateRecorder({
      serializeAddon: serializeAddon as never,
      sessionId: 'session-1',
      terminal: createTerminal() as never,
      minCaptureIntervalMs: 1_000,
      unthrottledCaptureCount: 1,
      now: () => currentTime,
    })

    recorder.record('RAW_1')
    currentTime = 100
    recorder.record('RAW_2')

    expect(serializeAddon.serialize).toHaveBeenCalledTimes(1)
    expect(recorder.resolve('RAW_2', { allowSerializeFallback: false })).toEqual(
      expect.objectContaining({
        rawSnapshot: 'RAW_1',
        serialized: 'SCREEN_1',
      }),
    )

    currentTime = 1_000
    recorder.record('RAW_3')

    expect(serializeAddon.serialize).toHaveBeenCalledTimes(2)
    expect(recorder.resolve('RAW_3', { allowSerializeFallback: false })).toEqual(
      expect.objectContaining({
        rawSnapshot: 'RAW_3',
        serialized: 'SCREEN_2',
      }),
    )
  })

  it('keeps the latest write-callback capture instead of trusting resolve-time fallback', () => {
    let currentTime = 0
    const serializeAddon = createSerializeAddon()
    const recorder = createCommittedScreenStateRecorder({
      serializeAddon: serializeAddon as never,
      sessionId: 'session-2',
      terminal: createTerminal() as never,
      minCaptureIntervalMs: 1_000,
      unthrottledCaptureCount: 1,
      now: () => currentTime,
    })

    recorder.record('RAW_1')
    currentTime = 100
    recorder.record('RAW_2')

    expect(recorder.resolve('RAW_2')).toEqual(
      expect.objectContaining({
        rawSnapshot: 'RAW_1',
        serialized: 'SCREEN_1',
      }),
    )
    expect(serializeAddon.serialize).toHaveBeenCalledTimes(1)
  })

  it('refreshes when the active terminal buffer kind changes', () => {
    const serializeAddon = createSerializeAddon()
    const terminal = createTerminal()
    const recorder = createCommittedScreenStateRecorder({
      serializeAddon: serializeAddon as never,
      sessionId: 'session-3',
      terminal: terminal as never,
      minCaptureIntervalMs: 1_000,
      now: () => 0,
    })

    recorder.record('RAW_NORMAL')
    terminal.buffer.active.type = 'alternate'

    expect(recorder.resolve('RAW_ALTERNATE')).toEqual(
      expect.objectContaining({
        bufferKind: 'alternate',
        rawSnapshot: 'RAW_ALTERNATE',
        serialized: 'SCREEN_2',
      }),
    )
    expect(serializeAddon.serialize).toHaveBeenCalledTimes(2)
  })
})
