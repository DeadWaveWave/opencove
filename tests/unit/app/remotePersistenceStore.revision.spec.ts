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

it('pairs remote state/revision and uses that ancestor after a rejected newer read', async () => {
  const initial = createMergeState(0, 'initial')
  const latest = createMergeState(0, 'external')
  const values = [
    { ok: true, value: { revision: 1, state: initial } },
    { ok: true, value: { revision: 2, state: latest } },
    { ok: false, error: { code: 'persistence.invalid_state', debugMessage: 'revision conflict' } },
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
})
