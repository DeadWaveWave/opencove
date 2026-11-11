// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { executeLegacyFault as execute, failures } from './managedClaudeLegacyFaultHarness'

describe('unowned launch failure compatibility', () => {
  it.each(
    failures.flatMap(failure =>
      [false, true].flatMap(enabled =>
        (['claude-code', 'codex'] as const).map(provider => ({ failure, enabled, provider })),
      ),
    ),
  )(
    'preserves the legacy result and effects: $provider / flag=$enabled / $failure',
    async config => {
      // No intent: an unowned interaction remains legacy even when adoption is enabled.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      try {
        const baseline = await execute({ ...config, wrapped: false })
        expect(await execute({ ...config, wrapped: true })).toEqual(baseline)
        expect(baseline.effects).not.toContain('activation')
        expect(baseline.effects).not.toContain('reference')
        expect(baseline.effects).not.toContain('managedKill')
      } finally {
        vi.useRealTimers()
      }
    },
  )
})
