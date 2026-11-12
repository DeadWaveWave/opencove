import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionInputHandlers } from '../../../src/app/main/controlSurface/handlers/sessionInputHandlers'
import { registerSessionQueryHandlers } from '../../../src/app/main/controlSurface/handlers/sessionQueryHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { stateWithAgent } from '../../contract/platform/managedClaudeResumeBindingFixtures'
it.each(['session.kill', 'session.stopNode'] as const)(
  'protects the public %s boundary for owned runtimes',
  async id => {
    const kill = vi.fn()
    const surface = createControlSurface()
    const store = {
      readAppState: async () => stateWithAgent(),
      managedClaudeNodeIdForRuntime: () => 'agent',
    }
    const deps = {
      getPersistenceStore: async () => store,
      ptyRuntime: { kill },
      ptyStreamHub: { hasSession: () => true, isSessionActive: () => true },
    }
    registerSessionInputHandlers(surface, deps as never)
    registerSessionQueryHandlers(surface, deps as never, new Map(), (async () => ({
      value: { sessionId: 'old' },
    })) as never)
    const ctx = { now: () => new Date(), capabilities: {} } as ControlSurfaceContext
    const request = {
      kind: 'command' as const,
      id,
      payload: id === 'session.kill' ? { nodeId: 'agent' } : { nodeId: 'agent', sessionId: 'old' },
    }
    expect(await surface.invoke(ctx, request)).toMatchObject({
      ok: false,
      error: { details: { reason: 'clientUpgradeRequired' } },
    })
    expect(kill).not.toHaveBeenCalled()
    expect(
      await surface.invoke(
        { ...ctx, clientFeatures: { managedClaudeResumeBindingV1: true } },
        request,
      ),
    ).toMatchObject({ ok: true })
    expect(kill).toHaveBeenCalledExactlyOnceWith('old')
  },
)
