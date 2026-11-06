import { expect, it, vi } from 'vitest'
import { createBrowserPersistenceApi } from '@app/renderer/browser/browserOpenCoveApi.persistence'
import { invokeBrowserControlSurface } from '@app/renderer/browser/browserControlSurface'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import { createAppError } from '@shared/errors/appError'

vi.mock('@app/renderer/browser/browserControlSurface', () => ({
  invokeBrowserControlSurface: vi.fn(),
}))

it('merges against the accepted revision after a newer browser read', async () => {
  const api = createBrowserPersistenceApi()
  const state = {
    formatVersion: 1,
    activeWorkspaceId: null,
    workspaces: [],
    settings: DEFAULT_AGENT_SETTINGS,
  }
  const latest = { ...state, settings: { ...state.settings, releaseNotesSeenVersion: 'external' } }
  const invoke = vi.mocked(invokeBrowserControlSurface)
  invoke
    .mockResolvedValueOnce({ state, revision: 1 })
    .mockResolvedValueOnce({ state: latest, revision: 2 })
    .mockRejectedValueOnce(
      createAppError('persistence.invalid_state', { debugMessage: 'revision conflict' }),
    )
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
})
