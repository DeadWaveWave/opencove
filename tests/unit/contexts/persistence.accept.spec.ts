import { afterEach, expect, it, vi } from 'vitest'
import { useCanvasCollapseStore } from '../../../src/contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import {
  acceptPersistedStateSnapshot,
  readPersistedStateWithMeta,
  writePersistedState,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence'
import { LEGACY_STORAGE_KEY } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/constants'
import { installMockStorage } from '../../support/persistenceTestStorage'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'

installMockStorage()
afterEach(() => {
  useCanvasCollapseStore.setState({ workspaces: {} })
  window.localStorage.clear()
})

it.each(['primary', 'legacy'] as const)(
  'restores %s disclosure only after the hydration owner accepts the snapshot',
  async source => {
    const workspace = ensurePersistedWorkspace({
      id: 'restored-project',
      name: 'Restored project',
      path: '/tmp/restored-project',
      nodes: [],
      spaces: [],
      collapsedNodeIds: ['document'],
      collapsedSpaceIds: [],
    })!
    const state = { formatVersion: 1, activeWorkspaceId: workspace.id, workspaces: [workspace] }
    const writeAppState = vi.fn(async () => ({ ok: true, level: 'full', bytes: 1 }))
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        persistence: {
          readAppState: vi.fn(async () => ({ state: source === 'primary' ? state : null })),
          writeAppState,
        },
      },
    })
    if (source === 'legacy') {
      window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(state))
    }

    const snapshot = await readPersistedStateWithMeta()
    expect(snapshot.state?.workspaces[0]?.collapsedNodeIds).toEqual(['document'])
    expect(snapshot.isPersisted).toBe(true)
    expect(useCanvasCollapseStore.getState().workspaces[workspace.id]).toBeUndefined()
    if (source === 'legacy') {
      expect(writeAppState).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({
            workspaces: [expect.objectContaining({ collapsedNodeIds: ['document'] })],
          }),
        }),
      )
    }
    acceptPersistedStateSnapshot(snapshot)
    expect(useCanvasCollapseStore.getState().workspaces[workspace.id]?.collapsedNodeIds).toEqual({
      document: true,
    })
  },
)

it('restores disclosure after a failed legacy migration without suppressing the next write', async () => {
  const workspace = ensurePersistedWorkspace({
    id: 'migration-retry-project',
    name: 'Migration retry project',
    path: '/tmp/migration-retry-project',
    nodes: [],
    spaces: [],
    collapsedNodeIds: ['document'],
    collapsedSpaceIds: [],
  })!
  const state = { formatVersion: 1, activeWorkspaceId: workspace.id, workspaces: [workspace] }
  window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(state))
  const writeAppState = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      reason: 'io',
      error: createAppErrorDescriptor('persistence.io_failed'),
    })
    .mockResolvedValue({ ok: true, level: 'full', bytes: 123 })
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      persistence: {
        readAppState: vi.fn(async () => ({ state: null })),
        writeAppState,
      },
    },
  })

  const snapshot = await readPersistedStateWithMeta()
  expect(writeAppState).toHaveBeenCalledOnce()
  expect(snapshot.isPersisted).toBe(false)
  acceptPersistedStateSnapshot(snapshot)
  expect(useCanvasCollapseStore.getState().workspaces[workspace.id]?.collapsedNodeIds).toEqual({
    document: true,
  })
  await expect(writePersistedState(snapshot.state!)).resolves.toMatchObject({
    ok: true,
    bytes: 123,
  })
  expect(writeAppState).toHaveBeenCalledTimes(2)
})
