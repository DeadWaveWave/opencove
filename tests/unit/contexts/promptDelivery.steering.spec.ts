import { afterEach, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import { claudePromptDigest } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'

afterEach(() => vi.useRealTimers())
function working(provider: 'claude-code' | 'codex' = 'claude-code') {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture(undefined, provider)
  f.observe('UserPromptSubmit', 1000, { promptId: 'active', providerSessionId: 'provider' })
  const send = (deliveryId: string, caller = {}) =>
    f.service.deliver(
      {
        nodeId: 'n',
        text: 'prompt',
        timeoutMs: 15000,
        whenBusy: 'steer',
        deliveryId,
      },
      caller,
    )
  return { ...f, send }
}
it('admits working Claude steering and confirms same-ID draft-different text', async () => {
  const f = working()
  try {
    const result = f.send('one')
    await vi.advanceTimersByTimeAsync(300)
    f.observe('UserPromptSubmit', Date.now(), {
      promptId: 'active',
      providerSessionId: 'provider',
      promptDigest: claudePromptDigest('draft prompt'),
    })
    await expect(result).resolves.toMatchObject({
      deliveryId: 'one',
      mode: 'steer',
      turnId: 'turn',
      textComparison: 'different',
    })
  } finally {
    f.dispose()
  }
})
it('confirms Codex dispatches in order and marks other PTY bytes ambiguous', async () => {
  const f = working('codex')
  try {
    const one = f.send('one')
    await vi.advanceTimersByTimeAsync(300)
    await expect(one).resolves.toMatchObject({ phase: 'dispatched', mode: 'steer' })
    const two = f.send('two')
    await vi.advanceTimersByTimeAsync(300)
    await two
    f.observe('UserPromptSubmit', Date.now())
    expect(f.service.get('one')).toMatchObject({ status: 'submitted' })
    expect(f.service.get('two')).toMatchObject({ status: 'dispatched' })
    await f.hub.withSessionInputOperation('s', async input => {
      input.write('human')
    })
    expect(f.service.get('two')).toMatchObject({ status: 'ambiguous' })
  } finally {
    f.dispose()
  }
})
it('retains lookup by caller delivery ID after a lost response and upgrades a late receipt', async () => {
  const f = working()
  try {
    const abort = new AbortController()
    const result = f.send('lost-response', { signal: abort.signal })
    const rejected = expect(result).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
    await vi.advanceTimersByTimeAsync(300)
    abort.abort()
    await rejected
    expect(f.service.get('lost-response')).toMatchObject({
      status: 'unknown',
      evidenceWindow: 'closed',
    })
    f.observe('UserPromptSubmit', Date.now(), { promptId: 'active', providerSessionId: 'provider' })
    expect(f.service.get('lost-response')).toMatchObject({ status: 'submitted' })
  } finally {
    f.dispose()
  }
})

it.each(['human', 'automation'] as const)(
  'actual %s Hub writes make outstanding Codex input ambiguous',
  async writer => {
    const f = working('codex')
    try {
      const p = f.send('one')
      await vi.advanceTimersByTimeAsync(300)
      await p
      if (writer === 'human') {
        const ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() }
        f.hub.registerClient({ clientId: 'human', kind: 'desktop', ws: ws as never })
        f.hub.attach({ clientId: 'human', sessionId: 's', role: 'controller' })
        f.hub.write({ clientId: 'human', sessionId: 's', data: 'typed' })
      } else {
        await f.hub.writeAutomation({
          sessionId: 's',
          data: 'typed',
          assertActive: () => {},
          validateBinding: async () => {},
        })
      }
      await Promise.resolve()
      expect(f.service.get('one')).toMatchObject({ status: 'ambiguous' })
      f.observe('UserPromptSubmit', Date.now())
      expect(f.service.get('one')).toMatchObject({ status: 'ambiguous' })
    } finally {
      f.dispose()
    }
  },
)
