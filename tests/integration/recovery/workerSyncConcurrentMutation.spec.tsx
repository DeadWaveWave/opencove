import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkerSyncStateUpdates } from '../../../src/app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toShellWorkspaceState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  schedulePersistedStateWrite,
  flushScheduledPersistedStateWriteAsync,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/schedule'
import type { PersistedAppState } from '../../../src/contexts/workspace/presentation/renderer/types'
import type { PersistWriteResult, SyncEventPayload } from '../../../src/shared/contracts/dto'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'

const originalState = useAppStore.getState()
afterEach(async () => {
  await flushScheduledPersistedStateWriteAsync()
  useAppStore.setState(originalState, true)
})

function createWorkspace() {
  return toShellWorkspaceState(
    ensurePersistedWorkspace({
      id: 'workspace',
      name: 'Original project',
      path: '/tmp/workspace',
      nodes: [
        {
          id: 'task',
          kind: 'task',
          title: 'Task',
          position: { x: 0, y: 0 },
          width: 460,
          height: 280,
          task: { requirement: 'Keep this task linked to its agent', linkedAgentNodeId: null },
        },
        {
          id: 'agent',
          kind: 'agent',
          title: 'Agent',
          position: { x: 500, y: 0 },
          width: 520,
          height: 360,
          agent: { provider: 'codex', executionDirectory: '/tmp/workspace', taskId: 'task' },
        },
      ],
      spaces: [],
      activeSpaceId: null,
      viewport: { x: 0, y: 0, zoom: 1 },
    })!,
  )
}

it.each(['before', 'during', 'during-with-ack', 'after-unmount'] as const)(
  'preserves an unpublished local edit made %s a shared-state read',
  async timing => {
    const workspace = createWorkspace()
    useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id })
    const produce = () => toPersistedState(useAppStore.getState().workspaces, workspace.id)
    let sharedState = produce()
    let releaseRead!: () => void
    const readBarrier = new Promise<void>(resolve => {
      releaseRead = resolve
    })
    const readAppState = vi.fn(async () => {
      const state = sharedState
      await readBarrier
      return { state, recovery: null }
    })
    const writeAppState = vi.fn(async ({ state }: { state: PersistedAppState }) => {
      sharedState = state
      return { ok: true, level: 'full', bytes: 1, revision: 11 }
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
    const hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
    const edit = () => {
      useAppStore.getState().setWorkspaces(previous =>
        previous.map(project => ({
          ...project,
          name: `Local edit ${timing}`,
          nodes: project.nodes.map(node =>
            node.data.task
              ? {
                  ...node,
                  data: { ...node.data, task: { ...node.data.task, linkedAgentNodeId: 'agent' } },
                }
              : node,
          ),
        })),
      )
      schedulePersistedStateWrite(produce, { delayMs: 10_000 })
    }
    try {
      act(() => {
        if (timing === 'before') {
          edit()
        }
        emit({ type: 'app_state.updated', operationId: 'mount.create', revision: 10 })
      })
      await waitFor(() => expect(readAppState).toHaveBeenCalledOnce())
      await act(async () => {
        if (timing !== 'before') {
          edit()
        }
        if (timing === 'during-with-ack') {
          await flushScheduledPersistedStateWriteAsync()
        }
        if (timing === 'after-unmount') {
          hook.unmount()
        }
        releaseRead()
        await readBarrier
      })
      expect(useAppStore.getState().workspaces[0]!.name).toBe(`Local edit ${timing}`)
      expect(useAppStore.getState().workspaces[0]!.nodes[0]!.data.task?.linkedAgentNodeId).toBe(
        'agent',
      )
      if (timing === 'after-unmount') {
        await flushScheduledPersistedStateWriteAsync()
      }
      await waitFor(() => expect(writeAppState).toHaveBeenCalled())
      expect(sharedState.workspaces[0]!.name).toBe(`Local edit ${timing}`)
      expect(sharedState.workspaces[0]!.nodes[0]!.task?.linkedAgentNodeId).toBe('agent')
      if (timing === 'during-with-ack') {
        hook.unmount()
        // An ignored stale read must not poison the write deduplication cache:
        // reverting the acknowledged edit still needs an actual durable write.
        useAppStore.getState().setWorkspaces([workspace])
        schedulePersistedStateWrite(produce)
        await flushScheduledPersistedStateWriteAsync()
        expect(sharedState.workspaces[0]!.name).toBe('Original project')
      }
    } finally {
      releaseRead()
      hook.unmount()
    }
  },
)

it('retains a failed local write and resumes the pending refresh after a successful save', async () => {
  const workspace = createWorkspace()
  useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id })
  const produce = () => toPersistedState(useAppStore.getState().workspaces, workspace.id)
  let sharedState = produce()
  const readAppState = vi.fn(async () => ({ state: sharedState, recovery: null }))
  const writeAppState = vi
    .fn<({ state }: { state: PersistedAppState }) => Promise<PersistWriteResult>>()
    .mockResolvedValueOnce({
      ok: false,
      reason: 'io',
      error: createAppErrorDescriptor('persistence.io_failed'),
    })
    .mockImplementation(async ({ state }) => {
      sharedState = state
      return { ok: true, level: 'full', bytes: 1, revision: 21 }
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
  const hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
  try {
    act(() => {
      useAppStore
        .getState()
        .setWorkspaces(previous => previous.map(project => ({ ...project, name: 'Unsaved edit' })))
      schedulePersistedStateWrite(produce, { delayMs: 10_000 })
      emit({ type: 'app_state.updated', operationId: 'mount.create', revision: 20 })
    })
    await waitFor(() => expect(writeAppState).toHaveBeenCalledOnce())
    expect(readAppState).not.toHaveBeenCalled()
    expect(useAppStore.getState().workspaces[0]!.name).toBe('Unsaved edit')
    await act(async () => {
      schedulePersistedStateWrite(produce)
      expect(await flushScheduledPersistedStateWriteAsync()).toBe(true)
    })
    await waitFor(() => expect(readAppState).toHaveBeenCalledOnce())
    expect(useAppStore.getState().workspaces[0]!.name).toBe('Unsaved edit')
  } finally {
    hook.unmount()
  }
})
