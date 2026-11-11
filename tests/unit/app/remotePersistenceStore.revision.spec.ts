import {
  managedClaudeResumeState,
  rejectedManagedClaudeAgents,
} from '../../support/managedClaudeResumePersistenceFixtures'
import { normalizePersistedAppStateForMerge } from '../../../src/shared/sync/normalizePersistedAppStateForMerge'
import { expect, it, vi } from 'vitest'
import { createRemotePersistenceStore } from '../../../src/app/main/controlSurface/remote/remotePersistenceStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'

function createMergeState(_position: number, version: string) {
  return {
    formatVersion: 1,
    activeWorkspaceId: null,
    workspaces: [],
    settings: { ...DEFAULT_AGENT_SETTINGS, releaseNotesSeenVersion: version },
  }
}

it.each(['persistence.invalid_state'] as const)(
  'refreshes remote state against the accepted ancestor after %s',
  async code => {
    const initial = createMergeState(0, 'initial')
    const latest = createMergeState(0, 'external')
    const values = [
      { ok: true, value: { revision: 1, state: initial } },
      { ok: true, value: { revision: 2, state: latest } },
      { ok: false, error: { code, debugMessage: 'revision conflict' } },
      { ok: true, value: { revision: 2, state: latest } },
    ]
    const fetchMock = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ __opencoveControlEnvelope: true, ...values.shift() }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const store = createRemotePersistenceStore(async () => ({
        hostname: '127.0.0.1',
        port: 4310,
        token: 'test',
      }))
      expect(await store.readAppStateSnapshot!()).toEqual({ revision: 1, state: initial })
      await store.readAppState()
      expect(await store.writeAppState(initial, { baseRevision: 1 })).toMatchObject({
        ok: true,
        revision: 2,
        merged: true,
      })
      const request = JSON.parse(
        String((fetchMock.mock.calls[2] as unknown as [unknown, { body: string }])[1].body),
      )
      expect(request.payload.baseRevision).toBe(1)
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally {
      vi.unstubAllGlobals()
    }
  },
)

// e2e: recovery.empty-workspace-overwrite expects the Worker's own rejection, not a wrapped IO error.
it('returns a non-conflict Worker rejection unchanged', async () => {
  const durable = createMergeState(0, 'durable')
  const rejection = {
    code: 'persistence.invalid_state',
    debugMessage: 'Refusing to overwrite existing workspaces with an empty state.',
  }
  const values = [
    { ok: true, value: { revision: 3, state: durable } },
    { ok: false, error: rejection },
  ]
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ __opencoveControlEnvelope: true, ...values.shift() }),
    })),
  )
  try {
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'test',
    }))
    await store.readAppState()
    expect(await store.writeAppState(createMergeState(0, 'empty'), { baseRevision: 3 })).toEqual({
      ok: false,
      reason: 'io',
      error: rejection,
    })
  } finally {
    vi.unstubAllGlobals()
  }
})

it.each(rejectedManagedClaudeAgents)(
  'preserves the complete Worker rejection for $label',
  async ({ agent, field, rebasable }) => {
    const durable = managedClaudeResumeState()
    expect(normalizePersistedAppStateForMerge(durable, () => DEFAULT_AGENT_SETTINGS)).not.toBeNull()
    const candidate = structuredClone(durable)
    Object.assign(candidate.workspaces[0].nodes[0], { agent })
    expect(
      normalizePersistedAppStateForMerge(candidate, () => DEFAULT_AGENT_SETTINGS) !== null,
    ).toBe(rebasable)
    const rejection = {
      code: 'persistence.owned_node_identity_conflict',
      details: { nodeId: 'agent', field, reason: 'incompatible' },
      debugMessage: 'The owned agent identity cannot be replaced by a snapshot.',
    }
    const fetchMock = vi.fn(async (_url: unknown, init: { body: string }) => {
      const request = JSON.parse(init.body)
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ...(request.id === 'sync.state'
              ? { ok: true, value: { revision: 2, state: durable } }
              : { ok: false, error: rejection }),
          }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const store = createRemotePersistenceStore(async () => ({
        hostname: '127.0.0.1',
        port: 4310,
        token: 'test',
      }))
      await store.readAppState()
      expect(await store.writeAppState(candidate, { baseRevision: 2 })).toEqual({
        ok: false,
        reason: 'io',
        error: rejection,
      })
      const writes = fetchMock.mock.calls
        .map(([, init]) => JSON.parse(init.body))
        .filter(request => request.id === 'sync.writeState')
      expect(writes).toHaveLength(1)
      expect(writes[0].payload.state.workspaces[0].nodes[0].agent).toEqual(agent)
    } finally {
      vi.unstubAllGlobals()
    }
  },
)
