import { claudePromptDigest } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import { normalizeClaudeHookEnvelope } from '../../../src/app/main/controlSurface/agentHook/claudeHookProtocol'
import { afterEach, expect, it, vi } from 'vitest'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => {
  vi.useRealTimers()
})
it.each(['claude-code', 'codex'] as const)(
  '%s rejects late pre-Enter emission and missing provenance despite fresh local sequences',
  async provider => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const f = promptDeliveryRuntimeFixture(undefined, provider)
    try {
      const result = f.deliver()
      await vi.advanceTimersByTimeAsync(300)
      vi.setSystemTime(1400)
      f.observe('UserPromptSubmit', 1100) // Assigned a fresh sequence by real runtime ingress.
      let done = false
      void result.then(() => {
        done = true
      })
      await Promise.resolve()
      expect(done).toBe(false)
      f.observe('UserPromptSubmit')
      await Promise.resolve()
      expect(done).toBe(false)
      f.observe('notify', 1400) // Legacy done, even with a valid stamp, is never a receipt.
      await Promise.resolve()
      expect(done).toBe(false)
      f.observe('UserPromptSubmit', 1300)
      await expect(result).resolves.toMatchObject({ phase: 'submission_observed' })
    } finally {
      f.dispose()
    }
  },
)
it.each(['overall', 'receipt', 'caller'] as const)(
  'rejects %s overdue receipts before the overdue timer callback runs',
  async kind => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const scheduled: { cb: () => void; delay: number }[] = []
    const f = promptDeliveryRuntimeFixture((cb, delay) => {
      const task = { cb, delay }
      scheduled.push(task)
      return () => {
        const index = scheduled.indexOf(task)
        if (index >= 0) {
          scheduled.splice(index, 1)
        }
      }
    })
    let live = true
    try {
      const result = f.deliver(
        {
          assertActive: () => {
            if (!live) {
              throw new Error('revoked')
            }
          },
        },
        kind === 'overall' ? 1000 : 15000,
      )
      await Promise.resolve() // Acquire real Hub queue.
      const submitDelay = scheduled.find(task => task.delay === 300)!
      expect(submitDelay).toBeDefined()
      vi.setSystemTime(1300)
      submitDelay.cb()
      await Promise.resolve()
      await Promise.resolve()
      expect(f.write).toHaveBeenCalledTimes(2)
      vi.setSystemTime(kind === 'overall' ? 2101 : kind === 'receipt' ? 6301 : 1400)
      if (kind === 'caller') {
        live = false
      }
      const assertion = expect(result).rejects.toMatchObject({
        code: 'agent.prompt_stalled',
        details: {
          reason:
            kind === 'overall'
              ? 'deadline'
              : kind === 'receipt'
                ? 'receipt_deadline'
                : 'caller_revoked',
          pasteDispatchAttempted: true,
          submitDispatchAttempted: true,
        },
      })
      f.observe('UserPromptSubmit', Date.now(), { promptDigest: claudePromptDigest('prompt') })
      await assertion
    } finally {
      f.dispose()
    }
  },
)

it.each([
  ['matched', 'prompt', 'provider-id'],
  ['matched', 'prompt \t\r\n', 'provider-id'],
  ['different', 'draft prompt', 'different-id'],
  ['different', ' prompt', 'different-id'],
  ['unavailable', undefined, 'legacy-id'],
  ['unavailable', 42, 42],
  ['unavailable', '\ud800', 'x'.repeat(257)],
] as const)(
  'settles %s evidence without additional writes (%#)',
  async (comparison, prompt, id) => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const f = promptDeliveryRuntimeFixture()
    try {
      const result = f.deliver()
      await vi.advanceTimersByTimeAsync(300)
      const envelope = normalizeClaudeHookEnvelope({
        session_id: 'provider',
        transcript_path: '/tmp/t',
        cwd: '/tmp',
        hook_event_name: 'UserPromptSubmit',
        prompt,
        prompt_id: id,
      })!
      f.observe('UserPromptSubmit', Date.now(), envelope)
      const output = await result
      expect(output).toMatchObject({
        phase: 'submission_observed',
        textComparison: comparison,
        comparisonProfile: 'claude-code-v1',
      })
      expect(output.promptId).toBe(typeof id === 'string' && id.length <= 256 ? id : undefined)
      f.observe('UserPromptSubmit', Date.now(), { promptDigest: claudePromptDigest('other') })
      await vi.advanceTimersByTimeAsync(20000)
      expect(f.write.mock.calls.map(call => call[1])).toEqual(['\x1b[200~prompt\x1b[201~', '\r'])
      expect(JSON.stringify(output)).not.toContain('promptDigest')
    } finally {
      f.dispose()
    }
  },
)
it.each(['malformed', 'a'.repeat(63), 'A'.repeat(64), '😀'.repeat(64)])(
  'treats malformed internal digest %# as unavailable',
  async promptDigest => {
    vi.useFakeTimers()
    const f = promptDeliveryRuntimeFixture()
    try {
      const result = f.deliver()
      await vi.advanceTimersByTimeAsync(300)
      f.observe('UserPromptSubmit', Date.now(), { promptDigest })
      await expect(result).resolves.toMatchObject({ textComparison: 'unavailable' })
    } finally {
      f.dispose()
    }
  },
)
it('Codex stays unavailable even if given Claude comparison evidence', async () => {
  vi.useFakeTimers()
  const f = promptDeliveryRuntimeFixture(undefined, 'codex')
  try {
    const result = f.deliver()
    await vi.advanceTimersByTimeAsync(300)
    f.observe('UserPromptSubmit', Date.now(), {
      promptDigest: claudePromptDigest('prompt'),
      promptId: 'id',
    })
    const output = await result
    expect(output.textComparison).toBe('unavailable')
    expect(output).not.toHaveProperty('comparisonProfile')
    expect(output).not.toHaveProperty('promptId')
  } finally {
    f.dispose()
  }
})
it('compares synchronous receipts during Enter without delaying or bypassing the fence', async () => {
  vi.useFakeTimers()
  const f = promptDeliveryRuntimeFixture()
  try {
    f.write.mockImplementation((_id, text) => {
      if (text === '\r') {
        f.observe('UserPromptSubmit', Date.now(), { promptDigest: claudePromptDigest('prompt') })
      }
    })
    const result = f.deliver()
    await vi.advanceTimersByTimeAsync(300)
    await expect(result).resolves.toMatchObject({ textComparison: 'matched' })
    expect(f.write).toHaveBeenCalledTimes(2)
  } finally {
    f.dispose()
  }
})

it('late idle-turn receipt correlates after an un-timestamped start and an observed end', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture()
  try {
    const p = f.deliver()
    const failed = expect(p).rejects.toMatchObject({ code: 'agent.prompt_stalled' })
    await vi.advanceTimersByTimeAsync(300)
    f.observe('UserPromptSubmit', undefined, { promptId: 'new', providerSessionId: 'provider' })
    f.observe('Stop', Date.now(), { promptId: 'new', providerSessionId: 'provider' })
    await vi.advanceTimersByTimeAsync(5000)
    await failed
    const before = f.registry.get({ nodeId: 'n' })
    f.observe('UserPromptSubmit', Date.now(), { promptId: 'new', providerSessionId: 'provider' })
    expect(f.service.get('d')).toMatchObject({ status: 'submitted', mode: 'turn', turnId: 'turn' })
    expect(f.registry.get({ nodeId: 'n' })).toEqual(before)
  } finally {
    f.dispose()
  }
})

it('idle delivery requires a new prompt ID rather than a replay of the last ended prompt', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture()
  try {
    f.observe('UserPromptSubmit', Date.now(), { promptId: 'prior', providerSessionId: 'provider' })
    f.observe('Stop', Date.now(), { promptId: 'prior', providerSessionId: 'provider' })
    const p = f.deliver()
    await vi.advanceTimersByTimeAsync(300)
    f.observe('UserPromptSubmit', Date.now(), { promptId: 'prior', providerSessionId: 'provider' })
    expect(f.service.get('d')).toMatchObject({ status: 'pending' })
    f.observe('UserPromptSubmit', Date.now(), { promptId: 'new', providerSessionId: 'provider' })
    await expect(p).resolves.toMatchObject({ promptId: 'new' })
  } finally {
    f.dispose()
  }
})
