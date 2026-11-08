import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  playNotificationSound,
  resetNotificationSoundForTests,
  scheduleNotificationSound,
} from './notificationSound'

type Recorded = { type: string; params: Record<string, unknown>; events: unknown[][] }

/** A Web Audio graph that records what was scheduled instead of making sound. */
function createRecordingContext() {
  const nodes: Recorded[] = []
  const param = (events: unknown[][], name: string) => ({
    value: 0,
    setValueAtTime: (value: number, at: number) => events.push([name, 'set', value, at]),
    exponentialRampToValueAtTime: (value: number, at: number) =>
      events.push([name, 'ramp', value, at]),
  })
  const node = (type: string) => {
    const record: Recorded = { type, params: {}, events: [] }
    nodes.push(record)
    return {
      record,
      connect: (target: unknown) => target,
      start: (at: number) => record.events.push(['start', at]),
      stop: (at: number) => record.events.push(['stop', at]),
    }
  }
  const recordType = <N extends { record: Recorded }>(created: N): N =>
    Object.defineProperty(created, 'type', {
      set: (value: string) => (created.record.params.type = value),
    })
  const context = {
    currentTime: 10,
    state: 'running',
    destination: {},
    resume: vi.fn(async () => undefined),
    createOscillator: () => {
      const created = recordType(node('oscillator'))
      return Object.assign(created, { frequency: param(created.record.events, 'frequency') })
    },
    createGain: () => {
      const created = node('gain')
      return Object.assign(created, { gain: param(created.record.events, 'gain') })
    },
    createBiquadFilter: () => {
      const created = recordType(node('filter'))
      const frequency = {}
      Object.defineProperty(frequency, 'value', {
        set: (value: number) => (created.record.params.frequency = value),
      })
      return Object.assign(created, { frequency })
    },
  }
  return { context: context as unknown as AudioContext, nodes }
}

afterEach(() => {
  resetNotificationSoundForTests()
  vi.unstubAllGlobals()
})

describe('notification sounds', () => {
  it('plays the pixel bit as three rising square notes through a 2.5kHz lowpass', () => {
    const { context, nodes } = createRecordingContext()
    scheduleNotificationSound(context, 'bit', 60)

    const [master, filter] = nodes
    expect(master.events).toEqual([['gain', 'set', 0.6, 10.02]])
    expect(filter.params).toEqual({ type: 'lowpass', frequency: 2500 })
    const oscillators = nodes.filter(entry => entry.type === 'oscillator')
    expect(oscillators.map(entry => entry.params.type)).toEqual(['square', 'square', 'square'])
    expect(oscillators.map(entry => entry.events[0])).toEqual([
      ['frequency', 'set', 1046.5, 10.02],
      ['frequency', 'set', 1318.5, 10.075],
      ['frequency', 'set', 1568, expect.closeTo(10.13, 6)],
    ])
  })

  it('plays tide as two sine tones with triangle overtones, and pebble as one gliding drop', () => {
    const tide = createRecordingContext()
    scheduleNotificationSound(tide.context, 'tide', 100)
    expect(tide.nodes[1].params.frequency).toBe(4000)
    expect(
      tide.nodes.filter(entry => entry.type === 'oscillator').map(entry => entry.params.type),
    ).toEqual(['sine', 'triangle', 'sine', 'triangle'])

    const pebble = createRecordingContext()
    scheduleNotificationSound(pebble.context, 'pebble', 100)
    const [drop] = pebble.nodes.filter(entry => entry.type === 'oscillator')
    expect(drop.events.slice(0, 2)).toEqual([
      ['frequency', 'set', 880, 10.02],
      ['frequency', 'ramp', 840, expect.closeTo(10.05, 6)],
    ])
  })

  it('records instead of playing in test runs, and stays quiet at volume 0', () => {
    vi.stubGlobal('window', { opencoveApi: { meta: { isTest: true } } })
    playNotificationSound('bit', 0)
    playNotificationSound('tide', 40)
    expect(window.__opencoveNotificationSoundTestLog).toEqual([{ sound: 'tide', volume: 40 }])
  })
})
