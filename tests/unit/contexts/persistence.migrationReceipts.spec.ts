import { afterEach, expect, it, vi } from 'vitest'
import { readPersistedStateWithMeta } from '@contexts/workspace/presentation/renderer/utils/persistence/read'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import { STORAGE_KEY } from '@contexts/workspace/presentation/renderer/utils/persistence/constants'
import { installMockStorage } from '../../support/persistenceTestStorage'
installMockStorage()
const original = window.opencoveApi
const draft = {
  formatVersion: 1,
  activeWorkspaceId: null,
  workspaces: [],
  settings: DEFAULT_AGENT_SETTINGS,
}
afterEach(() => {
  window.localStorage.clear()
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original })
})
it.each(['corrected', 'merged', 'uncertain'] as const)(
  'reads the actual post-migration revision after a concurrent %s write',
  async flag => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    const canonical = {
      ...draft,
      settings: { ...draft.settings, releaseNotesSeenVersion: 'other-client' },
    }
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 0, state: null, recovery: null })
      .mockResolvedValue({ revision: 4, state: canonical, recovery: null })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        persistence: {
          readAppState: read,
          writeAppState: vi.fn(async () => ({
            ok: true,
            level: 'full',
            bytes: 1,
            revision: 3,
            [flag]: true,
          })),
        },
      },
    })
    expect(await readPersistedStateWithMeta()).toMatchObject({
      revision: 4,
      isPersisted: true,
      state: { settings: { releaseNotesSeenVersion: 'other-client' } },
    })
    expect(read).toHaveBeenCalledTimes(2)
  },
)
it('does not acknowledge a migration draft when corrected canonical read fails', async () => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  const read = vi
    .fn()
    .mockResolvedValueOnce({ revision: 0, state: null, recovery: null })
    .mockRejectedValue(new Error('disconnected'))
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      persistence: {
        readAppState: read,
        writeAppState: vi.fn(async () => ({
          ok: true,
          level: 'full',
          bytes: 1,
          revision: 3,
          corrected: true,
        })),
      },
    },
  })
  expect(await readPersistedStateWithMeta()).toMatchObject({ revision: null, isPersisted: false })
})
