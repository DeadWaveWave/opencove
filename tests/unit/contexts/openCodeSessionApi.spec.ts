import { afterEach, expect, it, vi } from 'vitest'
import { readOpenCodeSessionStatus } from '../../../src/contexts/agent/infrastructure/watchers/OpenCodeSessionApi'

afterEach(() => vi.unstubAllGlobals())

it.each([
  [{}, 'idle'],
  [{ other: { type: 'busy' } }, 'idle'],
  [{ session: { type: 'idle' } }, 'idle'],
  [{ session: { type: 'busy' } }, 'busy'],
  [{ session: { type: 'retry' } }, 'retry'],
  [{ session: { type: 'invalid' } }, null],
  [{ session: null }, null],
  [[], null],
  [null, null],
] as const)('normalizes status response %j to %s', async (payload, expected) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))))
  await expect(
    readOpenCodeSessionStatus({
      baseUrl: 'http://localhost:43123',
      cwd: '/workspace',
      sessionId: 'session',
    }),
  ).resolves.toBe(expected)
})

it('preserves transport failure instead of reporting idle', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  await expect(
    readOpenCodeSessionStatus({
      baseUrl: 'http://localhost:43123',
      cwd: '/workspace',
      sessionId: 'session',
    }),
  ).rejects.toThrow('offline')
})
