import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkerSyncStateUpdates } from '../../../src/app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toShellWorkspaceState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { markPersistedStateAsSynced } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/write'
import {
  schedulePersistedStateWrite,
  flushScheduledPersistedStateWriteAsync,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/schedule'
import {
  claimTask,
  releaseTask,
} from '../../../src/contexts/workspace/application/nodeControl/nodeTaskMutations'
import { appendNote } from '../../../src/contexts/workspace/application/nodeControl/nodeNoteAppend'
import type {
  NodeControlAppState,
  NodeControlAppStateStore,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { PersistedAppState } from '../../../src/contexts/workspace/presentation/renderer/types'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'
import { mergePersistedAppStates } from '../../../src/shared/sync/mergePersistedAppStates'
import { normalizePersistedAppStateForMerge } from '../../../src/shared/sync/normalizePersistedAppStateForMerge'
import { normalizeAgentSettings } from '../../../src/contexts/settings/domain/agentSettings'
import * as guards from '../../../src/contexts/workspace/presentation/renderer/utils/syncNodeGuards'

const original = useAppStore.getState(),
  api = window.opencoveApi
let hook: ReturnType<typeof renderHook> | undefined
afterEach(async () => {
  hook?.unmount()
  hook = undefined
  await flushScheduledPersistedStateWriteAsync()
  useAppStore.setState(original, true)
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: api })
  vi.restoreAllMocks()
})

it.each([false, true])(
  'converges live CLI mutations and retains them through the next renderer save (guard=%s)',
  async guarded => {
    const workspace = toShellWorkspaceState(
      ensurePersistedWorkspace({
        id: 'project',
        name: 'Project',
        path: '/repo',
        spaces: [],
        activeSpaceId: null,
        nodes: [
          {
            id: 'task',
            kind: 'task',
            title: 'Task',
            position: { x: 0, y: 0 },
            width: 460,
            height: 280,
            task: { requirement: 'Review', status: 'todo', linkedAgentNodeId: null },
          },
          {
            id: 'agent',
            kind: 'agent',
            title: 'Agent',
            position: { x: 500, y: 0 },
            width: 500,
            height: 400,
            agent: { provider: 'codex', taskId: null, executionDirectory: '/repo' },
          },
          {
            id: 'note',
            kind: 'note',
            title: 'Result',
            position: { x: 0, y: 400 },
            width: 300,
            height: 200,
            task: { text: 'Original' },
          },
        ],
      })!,
    )
    useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: 'project' })
    const produce = () => {
      const s = useAppStore.getState()
      return toPersistedState(s.workspaces, s.activeWorkspaceId, s.agentSettings)
    }
    let durable = produce(),
      revision = 1
    const snapshots = new Map([[revision, structuredClone(durable)]])
    let emit!: (event: SyncEventPayload) => void
    let operationId = 'task.claim'
    const store: NodeControlAppStateStore = {
      readAppState: async () => structuredClone(durable) as unknown as NodeControlAppState,
      readAppStateRevision: async () => revision,
      writeAppState: async (state, options) => {
        if (options?.expectedRevision !== revision) {
          return {
            ok: false,
            reason: 'unknown',
            error: createAppErrorDescriptor('persistence.invalid_state', {
              debugMessage: 'App state revision conflict (test)',
            }),
          }
        }
        durable = structuredClone(state) as unknown as PersistedAppState
        snapshots.set(++revision, structuredClone(durable))
        emit({ type: 'app_state.updated', operationId, revision })
        return { ok: true, level: 'full', bytes: 1, revision }
      },
    }
    const save = vi.fn(
      async ({ state, baseRevision }: { state: PersistedAppState; baseRevision: number }) => {
        const normalize = (s: PersistedAppState) =>
          normalizePersistedAppStateForMerge(s, normalizeAgentSettings)!
        durable = mergePersistedAppStates(
          normalize(durable),
          normalize(state),
          normalize(snapshots.get(baseRevision)!),
        ) as PersistedAppState
        snapshots.set(++revision, structuredClone(durable))
        return { ok: true, level: 'full', bytes: 1, revision, merged: true }
      },
    )
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        persistence: {
          readAppState: vi.fn(async () => ({
            state: structuredClone(durable),
            revision,
            recovery: null,
          })),
          writeAppState: save,
        },
        sync: {
          onStateUpdated: (listener: typeof emit) => {
            emit = listener
            return vi.fn()
          },
        },
      },
    })
    markPersistedStateAsSynced(durable, revision)
    hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
    await waitFor(() => expect(useAppStore.getState().workspaces[0].nodes).toHaveLength(3))
    const guard = vi
      .spyOn(guards, 'isNodeGuardedFromSyncOverwrite')
      .mockImplementation(id => guarded && id === 'agent')
    const authority = { projectId: 'project', nodeId: 'agent' }
    const now = new Date('2026-11-13T00:00:00Z')
    const agentTask = () =>
      useAppStore.getState().workspaces[0].nodes.find(n => n.id === 'agent')!.data.agent?.taskId
    const persistedAgentTask = () => {
      const agent = durable.workspaces[0].nodes.find(n => n.id === 'agent')!.agent
      return agent && 'taskId' in agent ? agent.taskId : undefined
    }
    const rendererSave = async (name: string) => {
      await act(async () => {
        useAppStore.getState().setWorkspaces(ws => ws.map(w => ({ ...w, name })))
        schedulePersistedStateWrite(produce)
        expect(await flushScheduledPersistedStateWriteAsync()).toBe(true)
      })
      await waitFor(() => expect(durable.workspaces[0].name).toBe(name))
    }
    try {
      await act(async () => {
        await claimTask({ store, now, authority, input: { taskNodeId: 'task' } })
      })
      // Prove (a) is false before the renderer runs its refresh.
      expect(persistedAgentTask()).toBe('task')
      await waitFor(() =>
        expect(
          useAppStore.getState().workspaces[0].nodes.find(n => n.id === 'task')!.data.task?.status,
        ).toBe('doing'),
      )
      await rendererSave('After claim')
      expect(persistedAgentTask()).toBe('task')
      expect(agentTask()).toBe('task')
      expect(durable.workspaces[0].nodes.find(n => n.id === 'task')!.task).toMatchObject({
        linkedAgentNodeId: 'agent',
        status: 'doing',
      })
      operationId = 'note.append'
      await act(async () => {
        await appendNote({ store, authority, input: { nodeId: 'note', text: 'CLI result' } })
      })
      await waitFor(() =>
        expect(
          useAppStore.getState().workspaces[0].nodes.find(n => n.id === 'note')!.data.note?.text,
        ).toBe('Original\n\nCLI result'),
      )
      await rendererSave('After append')
      expect(durable.workspaces[0].nodes.find(n => n.id === 'note')!.task).toMatchObject({
        text: 'Original\n\nCLI result',
      })
      operationId = 'task.release'
      await act(async () => {
        await releaseTask({
          store,
          now,
          authority,
          input: { taskNodeId: 'task', status: 'ai_done' },
        })
      })
      await waitFor(() => expect(agentTask()).toBeNull())
      await rendererSave('After release')
      expect(persistedAgentTask()).toBeNull()
      expect(durable.workspaces[0].nodes.find(n => n.id === 'task')!.task).toMatchObject({
        linkedAgentNodeId: null,
        status: 'ai_done',
      })
    } finally {
      guard.mockRestore()
    }
  },
)
