import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { useWorkerSyncStateUpdates } from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { acceptPersistedStateSnapshot } from '@contexts/workspace/presentation/renderer/utils/persistence/accept'
import {
  schedulePersistedStateWrite,
  flushScheduledPersistedStateWriteAsync,
} from '@contexts/workspace/presentation/renderer/utils/persistence/schedule'
import { writePersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { guardNodeFromSyncOverwrite } from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import { normalizePersistedAppStateForMerge } from '@shared/sync/normalizePersistedAppStateForMerge'
import { mergePersistedAppStates } from '@shared/sync/mergePersistedAppStates'
import {
  RevisionedSnapshotCache,
  writeRevisionedSnapshot,
} from '@shared/sync/revisionedSnapshotCache'
import {
  normalizeAgentSettings,
  isNormalizedAgentSettings,
} from '@contexts/settings/domain/agentSettings'
import type { SyncEventPayload, WriteAppStateInput } from '@shared/contracts/dto'

const originalState = useAppStore.getState()
const originalApi = window.opencoveApi
afterEach(async () => {
  await flushScheduledPersistedStateWriteAsync()
  useAppStore.setState(originalState, true)
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: originalApi })
  vi.useRealTimers()
})

it.each(['edit', 'creation', 'deletion', 'renewal', 'settings'] as const)(
  'rebases guarded nodes immediately: %s',
  async scenario => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01'))
    const nodeId = `guarded-note-${scenario}`
    const workspace = toShellWorkspaceState(
      ensurePersistedWorkspace({
        id: 'guarded-project',
        name: 'Project',
        path: '/tmp/project',
        spaces: [],
        nodes: [
          {
            id: 'other-note',
            kind: 'note',
            title: 'Other old title',
            position: { x: 500, y: 0 },
            width: 300,
            height: 200,
            task: { text: 'other' },
          },
          {
            id: nodeId,
            kind: 'note',
            title: 'Note',
            position: { x: 0, y: 0 },
            width: 300,
            height: 200,
            task: { text: 'old' },
          },
        ],
      })!,
    )
    useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id })
    const produce = () => {
      const current = useAppStore.getState()
      return toPersistedState(current.workspaces, current.activeWorkspaceId, current.agentSettings)
    }
    const normalize = (value: unknown) =>
      normalizePersistedAppStateForMerge(value, normalizeAgentSettings)
    const base = produce()
    let durable = normalize(base)!
    let revision = 1
    const cache = new RevisionedSnapshotCache<typeof durable>()
    cache.set(revision, durable)
    const readAppState = vi.fn(async () => {
      cache.set(revision, durable)
      return { state: durable, revision, recovery: null }
    })
    const writeAppState = vi.fn(async (input: WriteAppStateInput) => {
      const result = await writeRevisionedSnapshot({
        cache,
        state: input.state,
        baseRevision: input.baseRevision,
        normalize,
        read: readAppState,
        merge: mergePersistedAppStates,
        isConflict: error => error === 'conflict',
        write: async (state, expected) => {
          if (expected !== revision) {
            throw 'conflict'
          }
          durable = normalize(state)!
          return { revision: ++revision, corrected: false }
        },
      })
      return { ok: true, level: 'full', bytes: 1, revision: result.revision, merged: result.merged }
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
    acceptPersistedStateSnapshot({ state: base, revision, isPersisted: true })
    guardNodeFromSyncOverwrite(nodeId)
    if (scenario === 'edit' || scenario === 'renewal') {
      useAppStore.getState().setWorkspaces(previous =>
        previous.map(project => ({
          ...project,
          nodes: project.nodes.map(node =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, note: { text: 'local text' } } }
              : node,
          ),
        })),
      )
    }
    if (scenario === 'creation') {
      useAppStore.getState().setWorkspaces(previous =>
        previous.map(project => ({
          ...project,
          nodes: [
            ...project.nodes,
            { ...project.nodes.find(node => node.id === nodeId)!, id: 'local-created' },
          ],
        })),
      )
      guardNodeFromSyncOverwrite('local-created', 2500)
    }
    if (scenario === 'settings') {
      useAppStore
        .getState()
        .setAgentSettings(previous => ({ ...previous, releaseNotesSeenVersion: 'local settings' }))
      schedulePersistedStateWrite(produce, { delayMs: 10000 })
    }
    durable = {
      ...durable,
      // Only the settings scenario changes shared settings; the others prove unchanged
      // settings keep their identity.
      settings:
        scenario === 'settings'
          ? { ...durable.settings, releaseNotesSeenVersion: 'external' }
          : durable.settings,
      workspaces: durable.workspaces.map(project => ({
        ...project,
        nodes: [
          ...project.nodes
            .filter(node => scenario !== 'deletion' || node.id !== nodeId)
            .map(node => ({ ...node, title: 'External title' })),
          { ...project.nodes[0], id: 'external-created', title: 'New external node' },
        ],
      })),
    }
    revision = 2
    const settingsBeforeRefresh = useAppStore.getState().agentSettings
    const hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
    try {
      act(() => emit({ type: 'app_state.updated', operationId: 'node.update', revision }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(readAppState).toHaveBeenCalled()
      expect(isNormalizedAgentSettings(useAppStore.getState().agentSettings)).toBe(true)
      expect(
        produce().workspaces[0].nodes.find(node => node.id === 'external-created')?.title,
      ).toBe('New external node')
      expect(produce().workspaces[0].nodes.find(node => node.id === 'other-note')?.title).toBe(
        'External title',
      )
      const refreshed = produce().workspaces[0].nodes.find(node => node.id === nodeId)
      if (scenario === 'deletion') {
        expect(refreshed).toBeUndefined()
      } else {
        expect(refreshed?.title).toBe('External title')
        expect(refreshed?.task).toEqual({
          text: scenario === 'edit' || scenario === 'renewal' ? 'local text' : 'old',
        })
      }
      if (scenario === 'creation') {
        expect(produce().workspaces[0].nodes.some(node => node.id === 'local-created')).toBe(true)
      }
      if (scenario !== 'settings') {
        // A new settings identity re-renders the whole shell and remounts the editor the user
        // is typing in; unchanged settings must keep their object.
        expect(useAppStore.getState().agentSettings).toBe(settingsBeforeRefresh)
      }
      if (scenario === 'settings') {
        expect(writeAppState.mock.invocationCallOrder[0]).toBeLessThan(
          readAppState.mock.invocationCallOrder.at(-1)!,
        )
        expect(produce().settings.releaseNotesSeenVersion).toBe('local settings')
      }
      if (scenario === 'renewal') {
        for (let i = 0; i < 3; i++) {
          guardNodeFromSyncOverwrite(nodeId)
          durable = {
            ...durable,
            workspaces: durable.workspaces.map(project => ({
              ...project,
              nodes: project.nodes.map(node => ({ ...node, title: `External ${i}` })),
            })),
          }
          revision++
          act(() => emit({ type: 'app_state.updated', operationId: 'node.update', revision }))
          await act(async () => {
            await vi.advanceTimersByTimeAsync(100)
          })
          expect(produce().workspaces[0].nodes.find(node => node.id === nodeId)?.title).toBe(
            `External ${i}`,
          )
          expect(produce().workspaces[0].nodes.find(node => node.id === nodeId)?.task).toEqual({
            text: 'local text',
          })
        }
      }
      await act(async () => {
        expect((await writePersistedState(produce())).ok).toBe(true)
      })
      expect(durable.workspaces[0].nodes).toMatchObject(
        produce().workspaces[0].nodes.map(node => ({
          id: node.id,
          title: node.title,
          task: node.task,
        })),
      )
      if (scenario === 'edit') {
        expect(writeAppState.mock.calls[0][0].baseRevision).toBe(2)
        expect(durable.workspaces[0].nodes.find(node => node.id === nodeId)).toMatchObject({
          title: 'External title',
          task: { text: 'local text' },
        })
      }
      hook.unmount()
      const reads = readAppState.mock.calls.length
      await vi.advanceTimersByTimeAsync(3000)
      expect(readAppState).toHaveBeenCalledTimes(reads)
    } finally {
      hook.unmount()
    }
  },
)
