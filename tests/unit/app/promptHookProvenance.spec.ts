// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { inMemoryClaudeHookChannel } from '../../support/inMemoryClaudeHookChannel'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import { parseHookEmittedAt } from '../../../src/shared/runtime/agentHook/hookEmittedAt'
afterEach(() => vi.useRealTimers())
it.each([undefined, '', 'NaN', 'Infinity', ['1000'], '61001', '-1001'].map(header => ({ header })))(
  'rejects missing or invalid emitted-at header %j',
  ({ header }) => {
    expect(parseHookEmittedAt(header, 59000)).toBeUndefined()
  },
)
it.each(['1300', '2000'])(
  'real receiver accepts token-holder claimed stamp %s without authenticating a relay executable',
  async claimed => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const socket = inMemoryClaudeHookChannel(),
      f = promptDeliveryRuntimeFixture()
    const unsubscribe = socket.channel.onState(event => f.runtime.observe(event))
    try {
      const reservation = await socket.channel.reserveSpawn()
      reservation.commit('s')
      const token = reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!
      expect(await socket.post(token, 'Stop', '1000')).toBe(204)
      const result = f.deliver()
      await vi.advanceTimersByTimeAsync(300)
      vi.setSystemTime(1400)
      expect(await socket.post(token, 'UserPromptSubmit', '1100')).toBe(204)
      expect(await socket.post(token, 'UserPromptSubmit')).toBe(204)
      expect(await socket.post(token, 'UserPromptSubmit', '99999')).toBe(204)
      let done = false
      void result.then(() => {
        done = true
      })
      await Promise.resolve()
      expect(done).toBe(false)
      expect(await socket.post(token, 'UserPromptSubmit', claimed)).toBe(204)
      await expect(result).resolves.toMatchObject({ phase: 'submission_observed' })
    } finally {
      unsubscribe()
      f.dispose()
      await socket.channel.dispose()
    }
  },
)
