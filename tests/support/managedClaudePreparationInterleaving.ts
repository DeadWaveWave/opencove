import { expect, vi } from 'vitest'
import {
  compatibilityFixture,
  context,
  absent,
  deferred,
} from '../unit/contexts/managedClaudeLaunchCompatibility.helpers'
import { registerSessionPrepareOrReviveHandler } from '../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveHandler'
import { admitManagedClaudeLaunch } from '../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import type { PtyStreamHub } from '../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

/** Execute the actual legacy prepare and a concurrent capable adoption on one Worker. */
export async function checkLegacyPreparationInterleaving(input: {
  adoption: boolean
  client: string
  phase: 'mount' | 'fallback'
  capable?: boolean
}) {
  const f = compatibilityFixture({
    enabled: input.adoption,
    hasRuntime: id => id === 'replacement',
  })
  const node = f.state.workspaces[0].nodes[0]
  node.status = 'stopped'
  node.workerBinding = { endpointId: 'local', mountId: 'pending-mount' }
  const gate = deferred<void>(),
    entered = deferred<void>()
  const shell = vi.fn(() => ({ sessionId: 'extra-shell', profileId: null, runtimeKind: 'posix' }))
  const boundary = async (phase: typeof input.phase) => {
    if (input.phase === phase) {
      entered.resolve()
      await gate.promise
    }
  }
  f.surface.register('mount.list', {
    kind: 'query',
    validate: value => value,
    handle: async () => {
      await boundary('mount')
      return { mounts: [] }
    },
  })
  f.surface.register('pty.spawn', {
    kind: 'command',
    validate: value => value,
    handle: async ctx => {
      await boundary('fallback')
      ctx.assertActive?.()
      return shell()
    },
  })
  f.spawn.mockImplementation(async () => {
    await admitManagedClaudeLaunch('claude-code', '/repo')
    return {
      sessionId: 'replacement',
      provider: 'claude-code',
      resumeSessionId: 'B',
      executionContext: { endpoint: { kind: 'local' } },
    }
  })
  registerSessionPrepareOrReviveHandler(f.surface, {
    getPersistenceStore: f.getPersistenceStore,
    ptyStreamHub: { isSessionActive: () => false } as unknown as PtyStreamHub,
    ptyRuntime: {} as never,
    terminalRecoverySpawnAdmission: f.admission.terminalRecoverySpawnAdmission,
  })
  const wire = {
    kind: 'command' as const,
    id: 'session.prepareOrRevive',
    payload: { workspaceId: 'workspace', nodeIds: ['agent'] },
  }
  const request = input.client === 'Web' ? JSON.parse(JSON.stringify(wire)) : wire
  const preparing = f.surface.invoke(
    { ...context, clientFeatures: input.capable ? context.clientFeatures : undefined },
    request,
  )
  try {
    await entered.promise
    expect(await f.launch({ intent: { kind: 'launchNew', expected: absent } })).toMatchObject({
      ok: true,
    })
    const owned = f.store.observeManagedClaudeNode('agent').binding
    expect(Boolean(owned)).toBe(input.adoption)
    f.kill.mockClear()
    gate.resolve()
    if (input.adoption) {
      expect(await preparing).toMatchObject({
        ok: false,
        error: {
          code: 'agent.managed_launch_rejected',
          details: { reason: input.capable ? 'superseded' : 'clientUpgradeRequired' },
        },
      })
      expect(shell).not.toHaveBeenCalled()
      expect(f.store.observeManagedClaudeNode('agent').binding).toEqual(owned)
      expect(f.kill).not.toHaveBeenCalled()
    } else {
      expect(await preparing).toMatchObject({
        ok: true,
        value: { nodes: [{ sessionId: 'extra-shell' }] },
      })
      expect(shell).toHaveBeenCalledOnce()
    }
  } finally {
    gate.resolve()
    await preparing
    f.runtime.dispose()
  }
}
