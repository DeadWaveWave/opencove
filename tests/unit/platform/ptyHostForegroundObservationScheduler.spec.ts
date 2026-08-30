import { afterEach, describe, expect, it, vi } from 'vitest'
import { PtyHostForegroundObservationScheduler } from '../../../src/platform/process/ptyHost/foregroundObservationScheduler'

describe('PTY host foreground observation scheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps shell-marker and on-demand probe deadlines independent', async () => {
    vi.useFakeTimers()
    const scheduler = new PtyHostForegroundObservationScheduler()
    const observations: string[] = []

    scheduler.scheduleMarker('session-1', () => observations.push('marker'))
    scheduler.scheduleProbe('session-1', () => observations.push('probe-1'))
    await vi.advanceTimersByTimeAsync(50)
    scheduler.scheduleProbe('session-1', () => observations.push('probe-2'))
    await vi.advanceTimersByTimeAsync(300)

    expect(observations).toEqual(['probe-1', 'probe-2', 'marker'])
    scheduler.dispose()
  })

  it('clears both observation kinds when a session is killed', async () => {
    vi.useFakeTimers()
    const scheduler = new PtyHostForegroundObservationScheduler()
    const observe = vi.fn()
    scheduler.scheduleMarker('session-1', observe)
    scheduler.scheduleProbe('session-1', observe)

    scheduler.clearSession('session-1')
    await vi.runAllTimersAsync()

    expect(observe).not.toHaveBeenCalled()
    scheduler.dispose()
  })
})
