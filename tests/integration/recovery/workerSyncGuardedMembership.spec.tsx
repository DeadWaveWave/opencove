import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { useWorkerSyncStateUpdates } from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { acceptPersistedStateSnapshot } from '@contexts/workspace/presentation/renderer/utils/persistence/accept'
import {
  getSyncedPersistedState,
  writePersistedState,
} from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { guardNodeFromSyncOverwrite } from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import type { SyncEventPayload, WriteAppStateInput } from '@shared/contracts/dto'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'

const originalState = useAppStore.getState()
const originalApi = window.opencoveApi
afterEach(() => {
  useAppStore.setState(originalState, true)
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: originalApi })
  vi.useRealTimers()
})

it.each([
  { scenario: 'external move', local: 'a', latest: 'b', expected: 'b' },
  { scenario: 'external removal', local: 'a', latest: null, expected: null },
  { scenario: 'local move', local: 'b', latest: 'a', expected: 'b' },
  { scenario: 'local removal', local: null, latest: 'a', expected: null },
  { scenario: 'conflicting moves', local: 'c', latest: 'b', expected: 'c' },
  { scenario: 'in-flight creation', local: 'b', latest: null, expected: 'b' },
])(
  'rebases guarded membership through refresh and publication: $scenario',
  async ({ scenario, local, latest, expected }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-01-01'))
    const nodeId = `note-${scenario}`
    const workspace = toShellWorkspaceState(
      ensurePersistedWorkspace({
        id: 'membership-project',
        name: 'Project',
        path: '/tmp/project',
        nodes: [
          {
            id: nodeId,
            title: 'Note',
            kind: 'note',
            position: { x: 0, y: 0 },
            width: 300,
            height: 200,
            task: { text: 'old' },
          },
        ],
        spaces: ['a', 'b', 'c'].map(id => ({
          id,
          name: id,
          directoryPath: '/tmp/project',
          nodeIds: id === 'a' ? [nodeId] : [],
        })),
      })!,
    )
    useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id })
    const produce = () => {
      const current = useAppStore.getState()
      return toPersistedState(current.workspaces, current.activeWorkspaceId, current.agentSettings)
    }
    const base = produce()
    if (scenario === 'in-flight creation') {
      base.workspaces[0].nodes = []
      base.workspaces[0].spaces.forEach(space => {
        space.nodeIds = []
      })
    }
    let durable: PersistedAppState = {
      ...base,
      workspaces: base.workspaces.map(project => ({
        ...project,
        spaces: project.spaces.map(space => ({
          ...space,
          nodeIds: space.id === latest ? [nodeId] : [],
        })),
      })),
    }
    const readAppState = vi.fn(async () => ({ state: durable, revision: 2, recovery: null }))
    const writeAppState = vi.fn(async (input: WriteAppStateInput) => {
      expect(input.baseRevision).toBe(2)
      durable = input.state as PersistedAppState
      return { ok: true, level: 'full', bytes: 1, revision: 3 }
    })
    let emit!: (event: SyncEventPayload) => void
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        persistence: { readAppState, writeAppState },
        sync: {
          onStateUpdated: (listener: typeof emit) => {
            emit = listener
            return vi.fn()
          },
        },
      },
    })
    acceptPersistedStateSnapshot({ state: base, revision: 1, isPersisted: true })
    useAppStore.setState(state => ({
      workspaces: (previous =>
        previous.map(project => ({
          ...project,
          spaces: project.spaces.map(space => ({
            ...space,
            nodeIds: space.id === local ? [nodeId] : [],
          })),
          nodes: project.nodes.map(node => ({
            ...node,
            data: { ...node.data, note: { text: 'pending local text' } },
          })),
        })))(state.workspaces),
    }))
    guardNodeFromSyncOverwrite(nodeId)
    const memberships = (state: PersistedAppState) =>
      state.workspaces[0].spaces
        .filter(space => space.nodeIds.includes(nodeId))
        .map(space => space.id)
    const hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
    try {
      act(() => emit({ type: 'app_state.updated', operationId: 'node.update', revision: 2 }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      const expectedMemberships = expected ? [expected] : []
      expect(memberships(produce())).toEqual(expectedMemberships)
      expect(memberships(getSyncedPersistedState()!)).toEqual(latest ? [latest] : [])
      expect(produce().workspaces[0].nodes[0].task).toEqual({ text: 'pending local text' })
      expect((await writePersistedState(produce())).ok).toBe(true)
      expect(writeAppState).toHaveBeenCalledOnce()
      expect(memberships(durable)).toEqual(expectedMemberships)
      expect(durable.workspaces[0].nodes[0].task).toEqual({ text: 'pending local text' })
    } finally {
      hook.unmount()
    }
  },
)
