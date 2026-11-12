import { afterEach, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => vi.useRealTimers())
it.each(['waiting', 'degraded', 'replacement'] as const)(
  'unsafe %s latches before queue acquisition even after a safe refresh',
  async condition => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const f = promptDeliveryRuntimeFixture(undefined, 'codex')
    let release!: () => void
    try {
      f.observe('UserPromptSubmit', Date.now())
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      const held = f.hub.withSessionInputOperation('s', async () => gate)
      const p = f.service.deliver({
        nodeId: 'n',
        text: 'steer',
        timeoutMs: 15000,
        deliveryId: 'queued',
        whenBusy: 'steer',
      })
      const failed = expect(p).rejects.toMatchObject({
        details: { pasteDispatchAttempted: false, submitDispatchAttempted: false },
      })
      if (condition === 'waiting') {
        f.observe('PermissionRequest', Date.now())
      }
      if (condition === 'degraded') {
        const fence = f.registry.readFence({ sessionId: 's' })!
        f.registry.observe('s', {
          incarnation: 's',
          source: 'codex_hook',
          sourceSequence: (fence.watermarks.codex_hook ?? 0) + 100,
          state: 'unknown',
          degraded: true,
          observedAt: Date.now(),
          hookEventName: 'Stop',
        })
      }
      if (condition === 'replacement') {
        f.registry.register({
          sessionId: 's',
          nodeId: 'n',
          provider: 'codex',
          incarnation: 'other',
        })
      }
      f.observe('UserPromptSubmit', Date.now())
      if (condition === 'degraded') {
        f.registry.observe('s', {
          incarnation: 's',
          source: 'codex_hook',
          sourceSequence: 1000,
          state: 'working',
          observedAt: Date.now(),
        })
      }
      release()
      await held
      await vi.advanceTimersByTimeAsync(300)
      await failed
      expect(f.write).not.toHaveBeenCalled()
    } finally {
      release?.()
      f.dispose()
    }
  },
)

it.each(['refresh', 'idle'] as const)(
  'queued %s remains safe without an exact-turn guard',
  async transition => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const f = promptDeliveryRuntimeFixture(undefined, 'codex')
    let release!: () => void
    try {
      f.observe('UserPromptSubmit', Date.now())
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      const held = f.hub.withSessionInputOperation('s', async () => gate)
      const p = f.service.deliver({
        nodeId: 'n',
        text: 'steer',
        timeoutMs: 15000,
        deliveryId: 'queued',
        whenBusy: 'steer',
      })
      f.observe(transition === 'idle' ? 'Stop' : 'UserPromptSubmit', Date.now())
      release()
      await held
      await vi.advanceTimersByTimeAsync(300)
      if (transition === 'idle') {
        f.observe('UserPromptSubmit', Date.now())
      }
      await expect(p).resolves.toMatchObject({ mode: transition === 'idle' ? 'turn' : 'steer' })
      expect(f.write).toHaveBeenCalledTimes(2)
    } finally {
      release?.()
      f.dispose()
    }
  },
)

it('queued bracketed-paste loss latches even when mode returns before reservation', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture(undefined, 'codex')
  let release!: () => void
  try {
    f.observe('UserPromptSubmit', Date.now())
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const held = f.hub.withSessionInputOperation('s', async () => gate)
    const p = f.service.deliver({
      nodeId: 'n',
      text: 'steer',
      timeoutMs: 15000,
      deliveryId: 'queued',
      whenBusy: 'steer',
      expectTurnId: 'turn',
    })
    const failed = expect(p).rejects.toMatchObject({
      details: {
        reason: 'capability_lost',
        pasteDispatchAttempted: false,
        submitDispatchAttempted: false,
      },
    })
    f.hub.handlePtyData('s', '\x1b[?2004l')
    f.hub.handlePtyData('s', '\x1b[?2004h')
    release()
    await held
    await vi.advanceTimersByTimeAsync(300)
    await failed
    expect(f.write).not.toHaveBeenCalled()
    expect(f.service.get('queued')).toMatchObject({ status: 'not_sent' })
  } finally {
    release?.()
    f.dispose()
  }
})
it('queued competing input without an unresolved delivery reports its own distinct reason', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture(undefined, 'codex')
  let release!: () => void
  try {
    f.observe('UserPromptSubmit', Date.now())
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const held = f.hub.withSessionInputOperation('s', async () => gate)
    const human = f.hub.withSessionInputOperation('s', async input => input.write('human'))
    const p = f.service.deliver({
      nodeId: 'n',
      text: 'steer',
      timeoutMs: 15000,
      deliveryId: 'queued',
      whenBusy: 'steer',
    })
    const failed = expect(p).rejects.toMatchObject({
      code: 'agent.busy',
      details: {
        reason: 'competing_input',
        deliveryId: 'queued',
        pasteDispatchAttempted: false,
        submitDispatchAttempted: false,
      },
    })
    release()
    await held
    await human
    await vi.advanceTimersByTimeAsync(300)
    await failed
    expect(f.write.mock.calls.map(call => call[1])).toEqual(['human'])
  } finally {
    release?.()
    f.dispose()
  }
})

it('keeps the capability subscription through CR and releases it afterward', async () => {
  vi.useFakeTimers()
  const f = promptDeliveryRuntimeFixture(undefined, 'codex')
  const watch = f.hub.watchInputInvalidation.bind(f.hub)
  let watching = false
  vi.spyOn(f.hub, 'watchInputInvalidation').mockImplementation((id, listener) => {
    watching = true
    const stop = watch(id, listener)
    return () => {
      watching = false
      stop()
    }
  })
  try {
    f.observe('UserPromptSubmit', Date.now())
    f.write.mockImplementation((_id, data) => {
      if (data === '\r') {
        expect(watching).toBe(true)
        f.hub.handlePtyData('s', '\x1b[?2004l')
        f.hub.handlePtyData('s', '\x1b[?2004h')
      }
    })
    const p = f.service.deliver({
      nodeId: 'n',
      text: 'steer',
      timeoutMs: 15000,
      deliveryId: 'steer',
      whenBusy: 'steer',
    })
    await vi.advanceTimersByTimeAsync(300)
    await expect(p).resolves.toMatchObject({ phase: 'dispatched' })
    expect(watching).toBe(false)
  } finally {
    f.dispose()
  }
})
