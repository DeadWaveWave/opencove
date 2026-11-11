import { afterEach, expect, it, vi } from 'vitest'
import { createManagedClaudeDeliveryRuntime } from '../../../src/app/main/controlSurface/managedClaudeDeliveryRuntime'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import {
  compatibilityFixture,
  absent,
  context,
} from '../contexts/managedClaudeLaunchCompatibility.helpers'

afterEach(() => vi.unstubAllEnvs())
it.each([undefined, '1', '0'])(
  'wires production adoption and capabilities with override=%s',
  async value => {
    vi.stubEnv('OPENCOVE_MANAGED_CLAUDE_BINDINGS', value)
    const f = compatibilityFixture()
    const delivery = createManagedClaudeDeliveryRuntime({
      getStore: f.getPersistenceStore,
      killExactRuntime: f.kill,
      hasRuntime: () => true,
    })
    const surface = createControlSurface()
    registerSystemHandlers(surface, { appVersion: 'test' })
    expect(
      await surface.invoke(context, { kind: 'query', id: 'system.capabilities', payload: {} }),
    ).toMatchObject({
      ok: true,
      value: {
        features: {
          managedClaudeResumeBindingV1: true,
          managedClaudeResumeBindingDeliveryV1: true,
          managedClaudeResumeBindingWritesEnabled: value !== '0',
        },
      },
    })
    const execute = vi.fn(async () => ({
      sessionId: 'new',
      provider: 'claude-code',
      resumeSessionId: 'A',
      executionContext: { endpoint: { kind: 'local' } },
    }))
    const payload = {
      canvasNodeId: 'agent',
      cwd: '/repo',
      provider: 'claude-code' as const,
      prompt: '',
      intent: { kind: 'launchNew' as const, expected: absent },
    }
    const run = (ctx = context) =>
      delivery.managedClaude.run(
        ctx,
        payload,
        payload,
        async () => ({ nodeId: 'agent', projectId: 'workspace', spaceId: '' }),
        execute,
      )
    try {
      await run({ ...context, clientFeatures: {} })
      expect(f.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
      await run()
      expect(f.store.activateManagedClaudeRuntime).toHaveBeenCalledTimes(value === '0' ? 0 : 1)
      if (value === '0') {
        await f.store.activateManagedClaudeRuntime({
          nodeId: 'agent',
          activationId: 'owned',
          runtimeSessionId: null,
          tuple: absent.tuple,
        })
        const reserve = vi.spyOn(delivery.managedClaude.owner, 'reserve')
        await expect(run()).rejects.toMatchObject({ details: { reason: 'writesDisabled' } })
        expect(reserve).not.toHaveBeenCalled()
      }
    } finally {
      delivery.managedClaude.dispose()
      f.runtime.dispose()
    }
  },
)
