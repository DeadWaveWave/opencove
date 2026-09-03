import { describe, expect, it, vi } from 'vitest'
import { launchAgentWithStartupObservation } from '../../../src/app/main/controlSurface/handlers/agentLaunchStartupObservation'

describe('agent launch startup observation', () => {
  it('turns early active-writer PTY output into a launch failure and disposes listeners', async () => {
    let dataListener: ((event: { sessionId: string; data: string }) => void) | null = null
    const disposeData = vi.fn()
    const disposeExit = vi.fn()
    const kill = vi.fn()
    const ptyRuntime = {
      onData: vi.fn((listener: typeof dataListener) => {
        dataListener = listener
        return disposeData
      }),
      onExit: vi.fn(() => disposeExit),
      kill,
    }

    const launch = async () => {
      queueMicrotask(() => {
        dataListener?.({
          sessionId: 'failed-session',
          data: 'thread already has an active writer (code -32600)',
        })
      })
      return { sessionId: 'failed-session' }
    }

    await expect(
      launchAgentWithStartupObservation({
        launch,
        ptyRuntime,
        observationMs: 1_000,
      }),
    ).rejects.toThrow('active writer')
    expect(kill).toHaveBeenCalledWith('failed-session')
    expect(disposeData).toHaveBeenCalledTimes(1)
    expect(disposeExit).toHaveBeenCalledTimes(1)
  })

  it('drains output briefly when exit arrives before the active-writer text', async () => {
    let dataListener: ((event: { sessionId: string; data: string }) => void) | null = null
    let exitListener: ((event: { sessionId: string; exitCode: number }) => void) | null = null
    const ptyRuntime = {
      onData: vi.fn((listener: typeof dataListener) => {
        dataListener = listener
        return vi.fn()
      }),
      onExit: vi.fn((listener: typeof exitListener) => {
        exitListener = listener
        return vi.fn()
      }),
      kill: vi.fn(),
    }

    const launch = async () => {
      queueMicrotask(() => {
        exitListener?.({ sessionId: 'failed-session', exitCode: 1 })
        setTimeout(() => {
          dataListener?.({
            sessionId: 'failed-session',
            data: 'thread already has an active writer (-32600)',
          })
        }, 10)
      })
      return { sessionId: 'failed-session' }
    }

    await expect(
      launchAgentWithStartupObservation({ launch, ptyRuntime, observationMs: 250 }),
    ).rejects.toThrow('active writer')
  })

  it('extends the bounded drain when exit wins the race with active-writer output', async () => {
    vi.useFakeTimers()
    let dataListener: ((event: { sessionId: string; data: string }) => void) | null = null
    let exitListener: ((event: { sessionId: string; exitCode: number }) => void) | null = null
    const ptyRuntime = {
      onData: vi.fn((listener: typeof dataListener) => {
        dataListener = listener
        return vi.fn()
      }),
      onExit: vi.fn((listener: typeof exitListener) => {
        exitListener = listener
        return vi.fn()
      }),
      kill: vi.fn(),
    }

    try {
      const pending = launchAgentWithStartupObservation({
        launch: async () => ({ sessionId: 'failed-session' }),
        ptyRuntime,
        observationMs: 200,
      })
      const rejection = expect(pending).rejects.toThrow('active writer')
      await vi.advanceTimersByTimeAsync(190)
      exitListener?.({ sessionId: 'failed-session', exitCode: 1 })
      await vi.advanceTimersByTimeAsync(310)
      dataListener?.({
        sessionId: 'failed-session',
        data: 'thread already has an active writer (-32600)',
      })

      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a still-running launch after the bounded observation window', async () => {
    vi.useFakeTimers()
    const disposeData = vi.fn()
    const disposeExit = vi.fn()
    let dataListener: ((event: { sessionId: string; data: string }) => void) | null = null
    const ptyRuntime = {
      onData: vi.fn((listener: typeof dataListener) => {
        dataListener = listener
        return disposeData
      }),
      onExit: vi.fn(() => disposeExit),
      kill: vi.fn(),
    }

    const pending = launchAgentWithStartupObservation({
      launch: async () => ({ sessionId: 'live-session' }),
      ptyRuntime,
      observationMs: 250,
    })
    await vi.advanceTimersByTimeAsync(100)
    dataListener?.({ sessionId: 'live-session', data: 'normal startup output' })
    await vi.advanceTimersByTimeAsync(100)
    dataListener?.({ sessionId: 'live-session', data: 'more startup output' })
    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toEqual({ sessionId: 'live-session' })
    expect(disposeData).toHaveBeenCalledTimes(1)
    expect(disposeExit).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
