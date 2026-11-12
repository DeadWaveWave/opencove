import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionInputHandlers } from '../../../src/app/main/controlSurface/handlers/sessionInputHandlers'
import { registerSessionQueryHandlers } from '../../../src/app/main/controlSurface/handlers/sessionQueryHandlers'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { deferred } from '../contexts/managedClaudeLaunchCompatibility.helpers'

it.each(['stop', 'agent-stop', 'node-kill'] as const)(
  'revalidates the node association after an asynchronous binding read for %s',
  async route => {
    const control = createControlSurface()
    const state = normalizePersistedAppState({
      workspaces: [
        {
          id: 'workspace',
          name: 'Workspace',
          path: '/repo',
          nodes: [
            { id: 'N', kind: 'agent', sessionId: 'S', agent: { provider: 'claude-code' } },
            { id: 'other', kind: 'agent', sessionId: 'old', agent: { provider: 'claude-code' } },
          ],
        },
      ],
    })!
    const gate = deferred<void>()
    const entered = deferred<void>()
    const store = {
      readAppState: vi.fn(async () => {
        const snapshot = structuredClone(state)
        entered.resolve()
        await gate.promise
        return snapshot
      }),
      observeManagedClaudeNode: (id: string) => ({
        nodeId: id,
        nodeRuntimeSessionId:
          state.workspaces[0].nodes.find(node => node.id === id)?.sessionId ?? null,
        binding: null,
        retired: false,
      }),
      managedClaudeNodeIdForRuntime: () =>
        state.workspaces[0].nodes.find(node => node.sessionId === 'S')?.id ?? null,
    } as unknown as PersistenceStore
    const getPersistenceStore = vi.fn(async () => store)
    const kill = vi.fn()
    const hub = {
      hasSession: () => true,
      isSessionActive: () => true,
      observeAgentState: () => ({ nodeId: 'N', sessionId: 'S', state: 'running' }),
    }
    const deps = { getPersistenceStore, ptyRuntime: { kill }, ptyStreamHub: hub }
    registerSessionInputHandlers(control, deps as never)
    registerSessionQueryHandlers(control, deps as never, new Map(), (async () => ({
      value: { sessionId: 'S' },
    })) as never)
    const operation = control.invoke(
      { now: () => new Date(), clientFeatures: { managedClaudeResumeBindingV1: true } },
      route === 'node-kill'
        ? { kind: 'command', id: 'session.kill', payload: { nodeId: 'N' } }
        : {
            kind: 'command',
            id: 'session.stopNode',
            payload: {
              nodeId: 'N',
              sessionId: 'S',
              ...(route === 'agent-stop' ? { agentOnly: true } : {}),
            },
          },
    )
    await entered.promise
    state.workspaces[0].nodes[0].sessionId = 'T'
    state.workspaces[0].nodes[1].sessionId = 'S'
    gate.resolve()
    expect(await operation).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
    expect(kill).not.toHaveBeenCalled()
  },
)
