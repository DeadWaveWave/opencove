import { afterEach, expect, it, vi } from 'vitest'
import { OpenCodeSessionStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/OpenCodeSessionStateWatcher'
import { readOpenCodeSessionStatus } from '../../../src/contexts/agent/infrastructure/watchers/OpenCodeSessionApi'
vi.mock('../../../src/contexts/agent/infrastructure/watchers/OpenCodeSessionApi', () => ({
  readOpenCodeSessionStatus: vi.fn(),
}))
afterEach(() => vi.useRealTimers())
it('distinguishes explicit busy/idle boundaries from malformed status', async () => {
  vi.useFakeTimers()
  vi.mocked(readOpenCodeSessionStatus)
    .mockResolvedValueOnce('busy')
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce('idle')
    .mockResolvedValueOnce('busy')
    .mockResolvedValueOnce('busy')
  const onState = vi.fn()
  const watcher = new OpenCodeSessionStateWatcher({
    sessionId: 's',
    opencodeSessionId: 'provider',
    baseUrl: 'http://localhost',
    cwd: '.',
    launchMode: 'new',
    onState,
  })
  try {
    watcher.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(onState.mock.calls).toEqual([
      ['s', 'working', { hookEventName: 'busy' }],
      ['s', 'standby', { degraded: true }],
      ['s', 'standby', { hookEventName: 'task_complete' }],
      ['s', 'working', { hookEventName: 'busy' }],
    ])
  } finally {
    watcher.dispose()
  }
  expect(vi.getTimerCount()).toBe(0)
})
