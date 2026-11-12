import { expect, it } from 'vitest'
import { compatibilityFixture, context } from './managedClaudeLaunchCompatibility.helpers'
import { admitManagedClaudeLaunch } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { registerSessionPrepareOrReviveHandler } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveHandler'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

it.each(
  [false, true].flatMap(enabled => ['missing', 'failed'].map(lookup => ({ enabled, lookup }))),
)('preserves local mount fallback enabled=$enabled lookup=$lookup', async ({ enabled, lookup }) => {
  const f = compatibilityFixture({ enabled, live: false })
  f.state.workspaces[0].nodes[0].workerBinding = { endpointId: 'local', mountId: 'removed' }
  const observe = f.store.observeManagedClaudeNode.getMockImplementation()!
  f.store.observeManagedClaudeNode.mockImplementation(id => ({
    ...observe(id),
    context: {
      kind: 'agent',
      provider: 'claude-code',
      directory: '/repo',
      route: '{"endpointId":"local","mountId":"removed"}',
    },
  }))
  f.surface.register('mount.list', {
    kind: 'query',
    validate: x => x,
    handle: () => {
      if (lookup === 'failed') {
        throw new Error('mount lookup unavailable')
      }
      return { mounts: [] }
    },
  })
  f.spawn.mockImplementation(async () => {
    await admitManagedClaudeLaunch('claude-code', '/repo', null)
    return {
      sessionId: 'replacement',
      provider: 'claude-code',
      resumeSessionId: 'cached',
      executionContext: { endpoint: { kind: 'local' } },
    }
  })
  registerSessionPrepareOrReviveHandler(f.surface, {
    getPersistenceStore: f.getPersistenceStore,
    terminalRecoverySpawnAdmission: f.admission.terminalRecoverySpawnAdmission,
    ptyStreamHub: { isSessionActive: () => false } as unknown as PtyStreamHub,
    ptyRuntime: {} as never,
  })
  try {
    expect(
      await f.surface.invoke(context, {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId: 'workspace' },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        nodes: [
          {
            sessionId: 'replacement',
            workerBinding: { endpointId: 'local', mountId: null },
            agent: { resumeSessionId: 'cached', executionDirectory: '/repo' },
          },
        ],
      },
    })
    expect(f.spawn).toHaveBeenCalledOnce()
    expect(f.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
  } finally {
    f.runtime.dispose()
  }
})
it('continues to refuse an owned route change', async () => {
  const f = compatibilityFixture({ enabled: true })
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'owned',
    runtimeSessionId: null,
    tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
  })
  const observe = f.store.observeManagedClaudeNode.getMockImplementation()!
  f.store.observeManagedClaudeNode.mockImplementation(id => ({
    ...observe(id),
    context: {
      kind: 'agent',
      provider: 'claude-code',
      directory: '/repo',
      route: '{"endpointId":"local","mountId":"removed"}',
    },
  }))
  f.spawn.mockImplementation(async () => {
    await admitManagedClaudeLaunch('claude-code', '/repo', null)
    throw new Error('must not spawn')
  })
  try {
    expect(await f.launch({ intent: { kind: 'resumeCurrent' } })).toMatchObject({
      ok: false,
      error: { details: { reason: 'identityConflict' } },
    })
  } finally {
    f.runtime.dispose()
  }
})
