import { afterEach, expect, it, vi } from 'vitest'
import { PromptDeliveryService } from '../../../src/contexts/agent/application/PromptDeliveryService'
import type {
  RunStateFence,
  RunStateReceipt,
} from '../../../src/contexts/agent/application/ports/PromptDeliveryPorts'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => vi.useRealTimers())
function fixture(steer = true) {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const base = promptDeliveryRuntimeFixture()
  if (steer) {
    base.observe('UserPromptSubmit', 1000, { promptId: 'active' })
  }
  let identity = { promptId: 'active' }
  let fence = base.registry.readFence({ nodeId: 'n' })!
  let listener: (r: RunStateReceipt) => void = () => {}
  let invalidated = () => {}
  const writes: string[] = []
  const service = new PromptDeliveryService({
    runs: {
      promptIdentity: () => identity,
      readFence: () => fence,
      watchFence: (_f, cb) => {
        listener = cb
        return () => {}
      },
    },
    input: {
      watchInputInvalidation: (_id, onInvalidation) => {
        invalidated = onInvalidation
        return () => {
          invalidated = () => {}
        }
      },
      withSessionInputOperation: async (_id, cb) =>
        cb({
          generation: {},
          isLive: () => true,
          mode: () => ({ bracketedPaste: true, watermark: 1 }),
          write: data => {
            writes.push(data)
          },
          watchInvalidation: onInvalidation => {
            invalidated = onInvalidation
            return () => {}
          },
        }),
    },
    now: Date.now,
    createDeliveryId: () => 'fence',
    capability: () => ({ supported: true, submitDelayMs: 300 }),
    schedule: (cb, delay) => {
      const t = setTimeout(cb, delay)
      return () => clearTimeout(t)
    },
  })
  const change = (
    snapshot: Partial<RunStateFence['snapshot']>,
    context: Partial<RunStateFence> = {},
  ) => {
    fence = {
      ...fence,
      ...context,
      snapshot: { ...fence.snapshot, ...snapshot },
      cursor: fence.cursor + 1,
    }
    listener({ fence })
  }
  const receipt = () =>
    listener({
      fence,
      source: 'claude_hook',
      sourceSequence: 99,
      hookEventName: 'UserPromptSubmit',
      emittedAtMs: Date.now(),
      turnId: 'turn',
      promptId: fence.snapshot.turn ? identity.promptId : 'new',
    })
  return {
    service,
    writes,
    change,
    receipt,
    segment: () => {
      identity = { promptId: 'next-segment' }
      change({})
    },
    invalidate: () => invalidated(),
    send: (signal?: AbortSignal, timeoutMs = 15000) =>
      service.deliver(
        { nodeId: 'n', text: 'prompt', timeoutMs, whenBusy: steer ? 'steer' : undefined },
        { signal },
      ),
    dispose: () => {
      service.dispose()
      base.dispose()
    },
  }
}
it.each(['refresh', 'segment', 'idle'] as const)(
  'allows same-turn %s and re-admits before CR',
  async kind => {
    const f = fixture()
    try {
      const p = f.send()
      if (kind === 'refresh') {
        f.change({ state: 'working' })
      }
      if (kind === 'segment') {
        f.segment()
      }
      if (kind === 'idle') {
        f.change(
          { state: 'idle', turn: null },
          {
            lastTurnEnd: {
              source: 'claude_hook',
              sourceSequence: 3,
              observedAt: Date.now(),
              hookEventName: 'Stop',
            },
          },
        )
      }
      await vi.advanceTimersByTimeAsync(300)
      f.receipt()
      await expect(p).resolves.toMatchObject({ mode: kind === 'idle' ? 'turn' : 'steer' })
      expect(f.writes).toEqual(['\x1b[200~prompt\x1b[201~', '\r'])
    } finally {
      f.dispose()
    }
  },
)
it.each([
  'waiting',
  'degraded',
  'replacement',
  'reset',
  'capability',
  'revocation',
  'deadline',
] as const)('permanently cancels Enter on %s despite later safe state', async kind => {
  const f = fixture()
  const controller = new AbortController()
  try {
    const p = f.send(controller.signal, kind === 'deadline' ? 100 : 15000)
    const failed = expect(p).rejects.toMatchObject({
      code: 'agent.prompt_interrupted',
      details: { submitDispatchAttempted: false },
    })
    if (kind === 'waiting') {
      f.change({ state: 'waiting' })
    }
    if (kind === 'degraded') {
      f.change({ quality: 'degraded' })
    }
    if (kind === 'replacement') {
      f.change({ turn: { id: 'other', startedAt: 1000, start: 'observed' } })
    }
    if (kind === 'reset') {
      f.change({ state: 'unknown', turn: null })
    }
    if (kind === 'capability') {
      f.invalidate()
    }
    if (kind === 'revocation') {
      controller.abort()
    }
    if (kind === 'deadline') {
      await vi.advanceTimersByTimeAsync(100)
    }
    f.change({ state: 'working', quality: 'authoritative' })
    await vi.advanceTimersByTimeAsync(300)
    await failed
    expect(f.writes).toHaveLength(1)
    expect(f.service.get('fence')).toMatchObject({ status: 'not_sent' })
  } finally {
    f.dispose()
  }
})
it('idle legacy requests never acquire steering permission', async () => {
  const f = fixture(false)
  try {
    const p = f.send()
    const failed = expect(p).rejects.toMatchObject({ code: 'agent.prompt_interrupted' })
    f.change({ state: 'working', turn: { id: 'other', startedAt: 1000, start: 'observed' } })
    await vi.advanceTimersByTimeAsync(300)
    await failed
    expect(f.writes).toHaveLength(1)
  } finally {
    f.dispose()
  }
})

it('same-source idle refresh preserves legacy turn admission', async () => {
  const f = fixture(false)
  try {
    const p = f.send()
    f.change({ state: 'idle' })
    await vi.advanceTimersByTimeAsync(300)
    f.receipt()
    await expect(p).resolves.toMatchObject({ phase: 'submission_observed' })
    expect(f.writes).toHaveLength(2)
  } finally {
    f.dispose()
  }
})
