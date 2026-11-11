import {
  managedClaudeResumeState,
  rejectedManagedClaudeAgents,
} from '../../support/managedClaudeResumePersistenceFixtures'
import { normalizePersistedAppStateForMerge } from '../../../src/shared/sync/normalizePersistedAppStateForMerge'
import { expect, it, vi } from 'vitest'
import { createBrowserPersistenceApi } from '@app/renderer/browser/browserOpenCoveApi.persistence'
import { invokeBrowserControlSurface } from '@app/renderer/browser/browserControlSurface'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import { createAppError } from '@shared/errors/appError'

vi.mock('@app/renderer/browser/browserControlSurface', () => ({
  invokeBrowserControlSurface: vi.fn(),
}))

it.each(['persistence.invalid_state'] as const)(
  'refreshes and merges browser state after %s',
  async code => {
    const api = createBrowserPersistenceApi()
    const state = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: DEFAULT_AGENT_SETTINGS,
    }
    const latest = {
      ...state,
      settings: { ...state.settings, releaseNotesSeenVersion: 'external' },
    }
    const invoke = vi.mocked(invokeBrowserControlSurface)
    invoke.mockReset()
    invoke
      .mockResolvedValueOnce({ state, revision: 1 })
      .mockResolvedValueOnce({ state: latest, revision: 2 })
      .mockRejectedValueOnce(createAppError(code, { debugMessage: 'revision conflict' }))
      .mockResolvedValueOnce({ state: latest, revision: 2 })
    expect(await api.readAppState()).toMatchObject({ revision: 1 })
    await api.readAppState()
    expect(await api.writeAppState({ state, baseRevision: 1 })).toMatchObject({
      ok: true,
      merged: true,
      revision: 2,
    })
    expect(invoke.mock.calls.filter(([call]) => call.id === 'sync.writeState')).toEqual([
      [expect.objectContaining({ payload: expect.objectContaining({ baseRevision: 1 }) })],
    ])
  },
)

it.each(rejectedManagedClaudeAgents)(
  'preserves the complete browser rejection for $label',
  async ({ agent, field, rebasable }) => {
    const durable = managedClaudeResumeState()
    expect(normalizePersistedAppStateForMerge(durable, () => DEFAULT_AGENT_SETTINGS)).not.toBeNull()
    const candidate = structuredClone(durable)
    Object.assign(candidate.workspaces[0].nodes[0], { agent })
    expect(
      normalizePersistedAppStateForMerge(candidate, () => DEFAULT_AGENT_SETTINGS) !== null,
    ).toBe(rebasable)
    const rejection = {
      code: 'persistence.owned_node_identity_conflict' as const,
      details: { nodeId: 'agent', field, reason: 'incompatible' },
      debugMessage: 'The owned agent identity cannot be replaced by a snapshot.',
    }
    const invoke = vi.mocked(invokeBrowserControlSurface)
    invoke.mockReset().mockImplementation(async request => {
      if (request.id === 'sync.state') {
        return { revision: 2, state: durable }
      }
      throw createAppError(rejection)
    })
    const api = createBrowserPersistenceApi()
    await api.readAppState()
    expect(await api.writeAppState({ state: candidate, baseRevision: 2 })).toEqual({
      ok: false,
      reason: 'unknown',
      error: rejection,
    })
    const writes = invoke.mock.calls
      .map(([request]) => request)
      .filter(request => request.id === 'sync.writeState')
    expect(writes).toHaveLength(1)
    expect(writes[0].payload).toMatchObject({ state: { workspaces: [{ nodes: [{ agent }] }] } })
  },
)
