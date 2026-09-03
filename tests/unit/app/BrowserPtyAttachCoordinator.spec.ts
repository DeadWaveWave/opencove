import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPtyAttachCoordinator } from '../../../src/app/renderer/browser/BrowserPtyAttachCoordinator'
import type { BrowserPtySocketLease } from '../../../src/app/renderer/browser/BrowserPtySocketLifecycle'

function lease(): BrowserPtySocketLease {
  return Object.freeze({})
}

describe('BrowserPtyAttachCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('settles only from the exact lease, session, role, and authority epoch', async () => {
    const coordinator = new BrowserPtyAttachCoordinator()
    const currentLease = lease()
    const pending = coordinator.begin({ sessionId: 'session-a', lease: currentLease })
    coordinator.noteHelloAck(currentLease)

    expect(pending.shouldSend).toBe(true)
    expect(
      coordinator.noteAttached(lease(), {
        type: 'attached',
        sessionId: 'session-a',
        role: 'controller',
        authorityEpoch: 3,
      }),
    ).toBeNull()
    expect(
      coordinator.noteAttached(currentLease, {
        type: 'attached',
        sessionId: 'session-a',
        role: 'invalid',
        authorityEpoch: 3,
      }),
    ).toBeNull()
    expect(
      coordinator.noteAttached(currentLease, {
        type: 'attached',
        sessionId: 'session-a',
        role: 'controller',
        authorityEpoch: null,
      }),
    ).toBeNull()

    expect(
      coordinator.noteAttached(currentLease, {
        type: 'attached',
        sessionId: 'session-a',
        role: 'controller',
        authorityEpoch: 3,
      }),
    ).toEqual({
      sessionId: 'session-a',
      authority: { role: 'controller', epoch: 3 },
    })
    await expect(pending.result).resolves.toEqual({
      sessionId: 'session-a',
      authority: { role: 'controller', epoch: 3 },
    })
  })

  it('shares one pending attach for the same lease and session', () => {
    const coordinator = new BrowserPtyAttachCoordinator()
    const currentLease = lease()
    const first = coordinator.begin({ sessionId: 'session-a', lease: currentLease })
    const second = coordinator.begin({ sessionId: 'session-a', lease: currentLease })

    expect(first.shouldSend).toBe(true)
    expect(second.shouldSend).toBe(false)
    expect(second.result).toBe(first.result)
    const ignored = first.result.catch(() => undefined)
    coordinator.rejectSession('session-a', new Error('test cleanup'))
    void ignored
  })

  it('rejects pending authority immediately when its socket lease retires', async () => {
    const coordinator = new BrowserPtyAttachCoordinator()
    const currentLease = lease()
    const pending = coordinator.begin({ sessionId: 'session-a', lease: currentLease })
    const rejection = expect(pending.result).rejects.toThrow('socket closed')

    coordinator.retireLease(currentLease, new Error('socket closed'))

    await rejection
  })

  it('times out malformed or missing acknowledgements', async () => {
    vi.useFakeTimers()
    const coordinator = new BrowserPtyAttachCoordinator(250)
    const pending = coordinator.begin({ sessionId: 'session-a', lease: lease() })
    const rejection = expect(pending.result).rejects.toThrow('Timed out waiting for PTY attach')

    await vi.advanceTimersByTimeAsync(250)

    await rejection
  })
})
