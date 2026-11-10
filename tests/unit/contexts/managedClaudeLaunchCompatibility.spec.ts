import { describe, it, expect, vi } from 'vitest'
import { admitManagedClaudeLaunch } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { registerSessionPrepareOrReviveHandler } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveHandler'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import {
  compatibilityFixture,
  context,
  absent,
  deferred,
} from './managedClaudeLaunchCompatibility.helpers'

describe('managed Claude launch legacy compatibility', () => {
  it('joins an owned replacement before its deferred identity read with the flag off', async () => {
    const f = compatibilityFixture({ enabled: false })
    await f.runtime.ready()
    await f.store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'owned',
      runtimeSessionId: 'live',
      tuple: { resumeSessionId: 'cached', resumeSessionIdVerified: true },
    })
    f.spawn.mockImplementation(async () => {
      await admitManagedClaudeLaunch('claude-code', '/repo')
      return {
        sessionId: 'replacement',
        provider: 'claude-code',
        resumeSessionId: 'new',
        executionContext: { endpoint: { kind: 'local' } },
      }
    })
    const identityRead = deferred<typeof f.state>(),
      entered = deferred<void>()
    f.store.readAppState.mockImplementationOnce(() => {
      entered.resolve()
      return identityRead.promise
    })
    registerSessionPrepareOrReviveHandler(f.surface, {
      getPersistenceStore: f.getPersistenceStore,
      ptyStreamHub: { isSessionActive: () => true } as unknown as PtyStreamHub,
      ptyRuntime: {} as never,
      terminalRecoverySpawnAdmission: f.admission.terminalRecoverySpawnAdmission,
    })
    const launching = f.launch({
      intent: {
        kind: 'launchNew',
        expected: {
          activationId: 'owned',
          tuple: { resumeSessionId: 'cached', resumeSessionIdVerified: true },
        },
      },
    })
    await entered.promise
    const preparing = f.surface.invoke(context, {
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'workspace' },
    })
    try {
      await vi.waitFor(() => expect(f.store.readAppState).toHaveBeenCalledTimes(2))
      identityRead.resolve(f.state)
      expect(await launching).toMatchObject({ ok: true })
      expect(await preparing).toMatchObject({
        ok: true,
        value: {
          nodes: [
            {
              recoveryState: 'live',
              sessionId: 'replacement',
              managedClaudeBinding: { runtimeSessionId: 'replacement' },
            },
          ],
        },
      })
      expect(f.kill).toHaveBeenCalledExactlyOnceWith('live')
      expect(f.store.activateManagedClaudeRuntime).toHaveBeenCalledTimes(3)
    } finally {
      identityRead.resolve(f.state)
      await Promise.all([launching, preparing])
      f.runtime.dispose()
    }
  })
  it.each([
    { enabled: false, explicit: true },
    { enabled: true, explicit: false },
    { enabled: false, explicit: false },
  ])('rejects retired identities before legacy execution: %j', async ({ enabled, explicit }) => {
    const f = compatibilityFixture({ enabled, retired: true, persisted: false })
    try {
      expect(
        await f.launch(explicit ? { intent: { kind: 'launchNew', expected: absent } } : {}),
      ).toMatchObject({
        ok: false,
        error: { code: 'agent.managed_launch_rejected', details: { reason: 'nodeGone' } },
      })
      expect(f.spawn).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  })
  it('reattaches an unowned live Codex node with the flag off while launch identity is pending', async () => {
    const f = compatibilityFixture({ provider: 'codex', enabled: false })
    await f.runtime.ready()
    const identityRead = deferred<typeof f.state>(),
      entered = deferred<void>()
    f.store.readAppState.mockImplementationOnce(() => {
      entered.resolve()
      return identityRead.promise
    })
    registerSessionPrepareOrReviveHandler(f.surface, {
      getPersistenceStore: f.getPersistenceStore,
      ptyStreamHub: { isSessionActive: (id: string) => id === 'live' } as PtyStreamHub,
      ptyRuntime: {} as never,
      terminalRecoverySpawnAdmission: f.admission.terminalRecoverySpawnAdmission,
    })
    const launching = f.launch()
    await entered.promise
    let prepared: unknown
    const preparing = f.surface
      .invoke(context, {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId: 'workspace' },
      })
      .then(result => {
        prepared = result
      })
    try {
      await vi.waitFor(
        () =>
          expect(prepared).toMatchObject({
            ok: true,
            value: { nodes: [{ recoveryState: 'live', sessionId: 'live' }] },
          }),
        { timeout: 100 },
      )
      expect(f.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
    } finally {
      identityRead.resolve(f.state)
      await launching
      await preparing
      f.runtime.dispose()
    }
  })
})
