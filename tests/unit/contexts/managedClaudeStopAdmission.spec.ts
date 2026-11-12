import { expect, it, vi } from 'vitest'
import {
  assertManagedClaudeStopAllowed,
  assertManagedClaudeMutationAllowed,
} from '../../../src/app/main/controlSurface/managedClaudeCompatibility'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { compatibilityFixture, context, absent } from './managedClaudeLaunchCompatibility.helpers'
it.each([false, true])(
  'allows explicit Stop for a current client regardless of freeze=%s',
  frozen => {
    const store = {
      managedClaudeNodeIdForRuntime: id => (id === 'live' ? 'owned' : null),
    } as PersistenceStore
    expect(() => assertManagedClaudeStopAllowed(context, store, 'live')).not.toThrow()
    expect(() =>
      assertManagedClaudeStopAllowed({ ...context, clientFeatures: {} }, store, 'live'),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'clientUpgradeRequired' }),
      }),
    )
    expect(() =>
      assertManagedClaudeStopAllowed({ ...context, clientFeatures: {} }, store, 'unowned'),
    ).not.toThrow()
    if (frozen) {
      expect(() => assertManagedClaudeMutationAllowed(context, 'owned', false)).toThrow()
    } else {
      expect(() => assertManagedClaudeMutationAllowed(context, 'owned', true)).not.toThrow()
    }
  },
)
it('freezes an existing binding before reservation and keeps the current attempt intact', async () => {
  const f = compatibilityFixture({ enabled: true, writesEnabled: false, live: false })
  await f.runtime.ready()
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'A',
    runtimeSessionId: 'live',
    tuple: absent.tuple,
  })
  expect(() => assertManagedClaudeMutationAllowed(context, 'agent', false)).toThrow(
    expect.objectContaining({ details: expect.objectContaining({ reason: 'writesDisabled' }) }),
  )
  const attempt = f.runtime.owner.reserve('agent')
  const reserve = vi.spyOn(f.runtime.owner, 'reserve')
  expect(await f.launch()).toMatchObject({
    ok: false,
    error: { details: { reason: 'writesDisabled' } },
  })
  expect(() => f.runtime.reservePreparation(context, 'workspace')).toThrow()
  expect(f.spawn).not.toHaveBeenCalled()
  expect(reserve).not.toHaveBeenCalled()
  expect(f.runtime.owner.isCurrent(attempt)).toBe(true)
  f.runtime.dispose()
})

it.each(['resumeCurrent', 'launchNew', 'resumeConversation'] as const)(
  'returns typed freeze refusal before stale/identity checks or reservations for %s',
  async kind => {
    const f = compatibilityFixture({ enabled: true, writesEnabled: false })
    await f.runtime.ready()
    await f.store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'current',
      runtimeSessionId: 'live',
      tuple: { resumeSessionId: 'B', resumeSessionIdVerified: true },
    })
    const reserve = vi.spyOn(f.runtime.owner, 'reserve')
    const resume = vi.spyOn(f.runtime.owner.reservations, 'resume')
    f.store.readAppState.mockRejectedValue(new Error('Identity resolution must not run'))
    try {
      expect(
        await f.launch({
          cwd: '/stale-directory',
          intent:
            kind === 'resumeCurrent'
              ? { kind }
              : {
                  kind,
                  expected: absent,
                  ...(kind === 'resumeConversation' ? { resumeSessionId: 'A' } : {}),
                },
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'agent.managed_launch_rejected', details: { reason: 'writesDisabled' } },
      })
      expect(reserve).not.toHaveBeenCalled()
      expect(resume).not.toHaveBeenCalled()
      expect(f.store.readAppState).not.toHaveBeenCalled()
      expect(f.spawn).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  },
)
