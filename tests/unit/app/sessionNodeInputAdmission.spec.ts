import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionInputHandlers } from '../../../src/app/main/controlSurface/handlers/sessionInputHandlers'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { deferred } from '../contexts/managedClaudeLaunchCompatibility.helpers'

it('fences queued input after a stale binding snapshot returns', async () => {
  const control = createControlSurface()
  const state = normalizePersistedAppState({
    workspaces: [
      {
        id: 'workspace',
        name: 'Workspace',
        path: '/repo',
        nodes: [
          { id: 'N', kind: 'terminal', sessionId: 'S' },
          { id: 'other', kind: 'terminal', sessionId: 'old' },
        ],
      },
    ],
  })!
  const entered = deferred<void>(),
    gate = deferred<void>()
  let reads = 0
  const store = {
    readAppState: async () => {
      const snapshot = structuredClone(state)
      if (++reads === 2) {
        entered.resolve()
        await gate.promise
      }
      return snapshot
    },
    observeManagedClaudeNode: (nodeId: string) => ({
      nodeRuntimeSessionId:
        state.workspaces[0].nodes.find(node => node.id === nodeId)?.sessionId ?? null,
      retired: false,
    }),
  } as unknown as PersistenceStore
  const write = vi.fn()
  const runtime = {
    write,
    kill: vi.fn(),
    spawnSession: vi.fn(),
    resize: vi.fn(),
    waitForShellReady: vi.fn(),
    onData: () => () => {},
    onExit: () => () => {},
  }
  const hub = new PtyStreamHub({ replayWindowMaxBytes: 64000, ptyRuntime: runtime })
  hub.registerSessionMetadata({
    sessionId: 'S',
    kind: 'terminal',
    cwd: '/repo',
    command: 'sh',
    args: [],
    cols: 80,
    rows: 24,
    startedAt: '2026-11-11T00:00:00Z',
  })
  registerSessionInputHandlers(control, {
    getPersistenceStore: async () => store,
    ptyRuntime: runtime,
    ptyStreamHub: hub,
  })
  const operation = control.invoke(
    { now: () => new Date() },
    {
      kind: 'command',
      id: 'session.writeNode',
      payload: { nodeId: 'N', sessionId: 'S', data: 'wrong target' },
    },
  )
  try {
    await entered.promise
    state.workspaces[0].nodes[0].sessionId = 'T'
    state.workspaces[0].nodes[1].sessionId = 'S'
    gate.resolve()
    expect(await operation).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
    expect(write).not.toHaveBeenCalled()
  } finally {
    gate.resolve()
    await operation
    hub.forgetSession('S')
  }
})
