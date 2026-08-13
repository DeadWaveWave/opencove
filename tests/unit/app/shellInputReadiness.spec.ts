import { describe, expect, it, vi } from 'vitest'
import { ShellInputReadiness } from '../../../src/app/main/controlSurface/ptyStream/shellInputReadiness'

describe('ShellInputReadiness', () => {
  it('releases a fresh-shell command only after the session emits output', async () => {
    const readiness = new ShellInputReadiness(5_000)
    let released = false
    const waiting = readiness.wait('session-1').then(() => {
      released = true
    })

    await Promise.resolve()
    expect(released).toBe(false)

    readiness.markReady('session-1')
    await waiting
    expect(released).toBe(true)
  })

  it('remembers output that arrives before the spawn response is observed', async () => {
    const readiness = new ShellInputReadiness(5_000)
    readiness.markReady('session-1')

    await expect(readiness.wait('session-1')).resolves.toBeUndefined()
  })

  it('uses a bounded grace period for shells with an intentionally silent prompt', async () => {
    vi.useFakeTimers()
    try {
      const readiness = new ShellInputReadiness(5_000)
      const waiting = readiness.wait('session-1')

      await vi.advanceTimersByTimeAsync(4_999)
      let released = false
      void waiting.then(() => {
        released = true
      })
      await Promise.resolve()
      expect(released).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(waiting).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
