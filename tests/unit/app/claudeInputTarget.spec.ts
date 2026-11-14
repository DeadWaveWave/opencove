// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { routedClaudeDeliveryFixture } from './claudeRoutedDelivery.helpers'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/opencove-user-data' },
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))
it('reads the authenticated input namespace separately from ordinary ended prompt history and fences stale captures', async () => {
  const f = await routedClaudeDeliveryFixture('headless')
  try {
    const fence = f.fence()
    const snapshot = f.registry.get({ sessionId: 's' })
    const timers = vi.getTimerCount()
    expect(f.registry.promptIdentity(fence)?.providerSessionId).toBeUndefined()
    expect(f.registry.inputTarget?.(fence)).toEqual({
      providerSessionId: 'A',
      invocationId: 's',
      conversationGeneration: undefined,
    })
    expect(f.registry.get({ sessionId: 's' })).toEqual(snapshot)
    expect(vi.getTimerCount()).toBe(timers)
    for (const stale of [
      { ...fence, epoch: 'other' },
      { ...fence, incarnation: 'other' },
      { ...fence, bindingGeneration: fence.bindingGeneration + 1 },
      { ...fence, conversationGeneration: 99 },
    ]) {
      expect(f.registry.inputTarget?.(stale)).toBeUndefined()
    }
    await f.clear('B', 'A')
    expect(f.registry.inputTarget?.(fence)).toBeUndefined()
    expect(f.registry.inputTarget?.(f.fence())?.providerSessionId).toBe('B')
  } finally {
    await f.close()
  }
})
it('tracks accepted ordinary resumes, ignores stale lifecycle, and clears the target on invocation replacement', async () => {
  const f = await routedClaudeDeliveryFixture('headless')
  try {
    await f.hook('B', 'SessionStart', { source: 'resume' })
    expect(f.registry.inputTarget?.(f.fence())?.providerSessionId).toBe('B')
    await f.hook('A', 'SessionEnd')
    expect(f.registry.inputTarget?.(f.fence())?.providerSessionId).toBe('B')
    await f.hook('A', 'SessionStart', { source: 'resume' })
    expect(f.registry.inputTarget?.(f.fence())?.providerSessionId).toBe('A')
    await f.hook('A', 'SessionEnd')
    expect(f.registry.inputTarget?.(f.fence())).toBeUndefined()
    const old = f.fence()
    f.runtime.metadata({
      sessionId: 's',
      resumeSessionId: null,
      terminalAgentActivity: {
        provider: 'claude-code',
        invocationId: 'replacement',
        generation: 1,
        phase: 'active',
        observedAtMs: Date.now(),
        identityAuthority: null,
      },
    })
    expect(f.registry.inputTarget?.(old)).toBeUndefined()
    expect(f.registry.inputTarget?.(f.fence())).toBeUndefined()
  } finally {
    await f.close()
  }
})
it('does not invent an authenticated current conversation from legacy Stop evidence', () => {
  const f = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
  try {
    f.observe('Stop', Date.now(), { providerSessionId: 'historical', promptId: 'p' })
    expect(f.registry.inputTarget?.(f.registry.readFence({ sessionId: 's' })!)).toBeUndefined()
  } finally {
    f.dispose()
  }
})
