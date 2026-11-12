import { afterEach, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => vi.useRealTimers())
it.each(['retirement', 'binding', 'incarnation'] as const)(
  'disposes passive subscriptions on definitive %s but retains the DTO',
  async loss => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const f = promptDeliveryRuntimeFixture()
    const fenceStop = vi.fn(),
      evidenceStop = vi.fn(),
      inputStop = vi.fn()
    const watchFence = f.registry.watchFence.bind(f.registry)
    const watchEvidence = f.registry.watchSubmissionEvidence.bind(f.registry)
    const watchInput = f.hub.watchInput.bind(f.hub)
    vi.spyOn(f.registry, 'watchFence').mockImplementation((fence, listener) => {
      const stop = watchFence(fence, listener)
      return () => {
        stop()
        fenceStop()
      }
    })
    vi.spyOn(f.registry, 'watchSubmissionEvidence').mockImplementation((fence, listener) => {
      const stop = watchEvidence(fence, listener)
      return () => {
        stop()
        evidenceStop()
      }
    })
    vi.spyOn(f.hub, 'watchInput').mockImplementation((id, listener) => {
      const stop = watchInput(id, listener)
      return () => {
        stop()
        inputStop()
      }
    })
    try {
      f.observe('UserPromptSubmit', Date.now(), {
        promptId: 'active',
        providerSessionId: 'provider',
      })
      const abort = new AbortController()
      const p = f.service.deliver(
        { nodeId: 'n', text: 'steer', timeoutMs: 15000, deliveryId: 'retained', whenBusy: 'steer' },
        { signal: abort.signal },
      )
      const failed = expect(p).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
      await vi.advanceTimersByTimeAsync(300)
      abort.abort()
      await failed
      expect([
        fenceStop.mock.calls.length,
        evidenceStop.mock.calls.length,
        inputStop.mock.calls.length,
      ]).toEqual([0, 0, 0])
      if (loss === 'retirement') {
        f.hub.forgetSession('s')
      }
      if (loss === 'binding') {
        f.registry.bind('s', { nodeId: 'replacement' })
      }
      if (loss === 'incarnation') {
        f.registry.register({
          sessionId: 's',
          nodeId: 'n',
          provider: 'claude-code',
          incarnation: 'replacement',
        })
      }
      expect([
        fenceStop.mock.calls.length,
        evidenceStop.mock.calls.length,
        inputStop.mock.calls.length,
      ]).toEqual([1, 1, 1])
      await vi.advanceTimersByTimeAsync(31 * 60_000)
      expect(f.service.get('retained')).toMatchObject({
        status: 'unknown',
        evidenceWindow: 'closed',
      })
    } finally {
      f.dispose()
    }
  },
)
it('late-confirmed pinned records get thirty minutes of completed retention from settlement', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture(undefined, 'codex')
  try {
    f.observe('UserPromptSubmit', Date.now())
    const p = f.service.deliver({
      nodeId: 'n',
      text: 'steer',
      timeoutMs: 15000,
      deliveryId: 'late',
      whenBusy: 'steer',
    })
    await vi.advanceTimersByTimeAsync(300)
    await p
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    expect(f.service.get('late')).toMatchObject({ status: 'dispatched', evidenceWindow: 'closed' })
    f.observe('UserPromptSubmit', Date.now())
    expect(f.service.get('late')).toMatchObject({ status: 'submitted' })
    await vi.advanceTimersByTimeAsync(30 * 60_000 - 1)
    expect(f.service.get('late')).toMatchObject({ status: 'submitted' })
    await vi.advanceTimersByTimeAsync(1)
    expect(f.service.get('late')).toMatchObject({ available: false })
  } finally {
    f.dispose()
  }
})

it.each(['write-failure', 'other-input', 'turn-end'] as const)(
  'releases subscriptions when Codex %s cannot qualify for FIFO reconciliation',
  async reason => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const f = promptDeliveryRuntimeFixture(undefined, 'codex')
    const stopInput = vi.fn()
    const watch = f.hub.watchInput.bind(f.hub)
    vi.spyOn(f.hub, 'watchInput').mockImplementation((id, listener) => {
      const stop = watch(id, listener)
      return () => {
        stop()
        stopInput()
      }
    })
    try {
      f.observe('UserPromptSubmit', Date.now())
      if (reason === 'write-failure') {
        f.write.mockImplementation((_id, data) => {
          if (data === '\r') {
            throw new Error('uncertain write')
          }
        })
      }
      const p = f.service.deliver({
        nodeId: 'n',
        text: 'steer',
        timeoutMs: 15000,
        deliveryId: 'codex',
        whenBusy: 'steer',
      })
      const result =
        reason === 'write-failure'
          ? expect(p).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
          : expect(p).resolves.toMatchObject({ phase: 'dispatched' })
      await vi.advanceTimersByTimeAsync(300)
      await result
      if (reason === 'other-input') {
        await f.hub.withSessionInputOperation('s', async input => input.write('human'))
      }
      if (reason === 'turn-end') {
        f.observe('Stop', Date.now())
      }
      expect(stopInput).toHaveBeenCalledTimes(1)
      expect(f.service.get('codex')).toMatchObject({
        status: reason === 'other-input' ? 'ambiguous' : 'unknown',
        evidenceWindow: 'closed',
      })
    } finally {
      f.dispose()
    }
  },
)

it('caller disconnect alone during Codex CR keeps passive FIFO reconciliation', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture(undefined, 'codex')
  const abort = new AbortController()
  try {
    f.observe('UserPromptSubmit', Date.now())
    f.write.mockImplementation((_id, data) => {
      if (data === '\r') {
        abort.abort()
      }
    })
    const p = f.service.deliver(
      {
        nodeId: 'n',
        text: 'steer',
        timeoutMs: 15000,
        deliveryId: 'disconnected',
        whenBusy: 'steer',
      },
      { signal: abort.signal },
    )
    const failed = expect(p).rejects.toMatchObject({
      code: 'agent.prompt_stalled',
      details: { reason: 'caller_revoked', submitDispatchAttempted: true },
    })
    await vi.advanceTimersByTimeAsync(300)
    await failed
    expect(f.service.get('disconnected')).toMatchObject({ status: 'dispatched' })
    f.observe('UserPromptSubmit', Date.now())
    expect(f.service.get('disconnected')).toMatchObject({ status: 'submitted' })
  } finally {
    f.dispose()
  }
})
