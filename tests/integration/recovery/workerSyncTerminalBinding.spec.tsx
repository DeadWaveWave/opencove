import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { useWorkerSyncStateUpdates } from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { readPersistedStateWithMeta } from '@contexts/workspace/presentation/renderer/utils/persistence/read'
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

it.each(['none', 'note', 'terminal'] as const)(
  'preserves durable terminal bindings through read, refresh and publication (guard: %s)',
  async guard => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2032-01-01'))
    const terminalId = `terminal-binding-${guard}`
    const noteId = `note-binding-${guard}`
    const binding = {
      provider: 'codex' as const,
      resumeSessionId: 'verified-session',
      resumeSessionIdVerified: true,
    }
    const workspace = toShellWorkspaceState(
      ensurePersistedWorkspace({
        id: 'binding-project',
        name: 'Project',
        path: '/tmp/project',
        spaces: [],
        nodes: [
          {
            id: terminalId,
            kind: 'terminal',
            title: 'Terminal',
            position: { x: 0, y: 0 },
            width: 500,
            height: 300,
            agent: binding,
          },
          {
            id: noteId,
            kind: 'note',
            title: 'Note',
            position: { x: 600, y: 0 },
            width: 300,
            height: 200,
            task: { text: 'old' },
          },
        ],
      })!,
    )
    useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id })
    const produce = () => {
      const state = useAppStore.getState()
      return toPersistedState(state.workspaces, state.activeWorkspaceId, state.agentSettings)
    }
    let durable = produce()
    let revision = 1
    const readAppState = vi.fn(async () => ({ state: durable, revision, recovery: null }))
    const writeAppState = vi.fn(async (input: WriteAppStateInput) => {
      expect(input.baseRevision).toBe(revision)
      durable = input.state as PersistedAppState
      return { ok: true, level: 'full', bytes: 1, revision: ++revision }
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
    const snapshot = await readPersistedStateWithMeta()
    expect(snapshot.state!.workspaces[0].nodes[0]).toMatchObject({
      agent: null,
      terminalAgentBinding: binding,
    })
    useAppStore.setState({ workspaces: snapshot.state!.workspaces.map(toShellWorkspaceState) })
    acceptPersistedStateSnapshot(snapshot)
    if (guard === 'none') {
      expect((await writePersistedState(produce())).ok).toBe(true)
      expect(writeAppState).not.toHaveBeenCalled()
    } else {
      const guardedId = guard === 'note' ? noteId : terminalId
      guardNodeFromSyncOverwrite(guardedId)
      useAppStore.getState().setWorkspaces(previous =>
        previous.map(project => ({
          ...project,
          nodes: project.nodes.map(node =>
            node.id !== guardedId
              ? node
              : guard === 'note'
                ? { ...node, data: { ...node.data, note: { text: 'pending local text' } } }
                : { ...node, position: { x: 100, y: 100 } },
          ),
        })),
      )
    }
    const latestBinding = { ...binding, resumeSessionId: 'external-verified-session' }
    durable = {
      ...durable,
      workspaces: durable.workspaces.map(project => ({
        ...project,
        nodes: project.nodes.map(node =>
          node.id === terminalId
            ? { ...node, title: 'External terminal title', agent: latestBinding }
            : node,
        ),
      })),
    }
    revision = 2
    const hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
    try {
      act(() => emit({ type: 'app_state.updated', operationId: 'node.update', revision }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(useAppStore.getState().workspaces[0].nodes[0].data.terminalAgentBinding).toEqual(
        latestBinding,
      )
      expect(produce().workspaces[0].nodes[0]).toMatchObject({
        title: 'External terminal title',
        agent: latestBinding,
      })
      expect(getSyncedPersistedState()!.workspaces[0].nodes[0].agent).toEqual(latestBinding)
      expect((await writePersistedState(produce())).ok).toBe(true)
      expect(writeAppState).toHaveBeenCalledTimes(guard === 'none' ? 0 : 1)
      expect(durable.workspaces[0].nodes[0].agent).toEqual(latestBinding)
      if (guard === 'note') {
        expect(durable.workspaces[0].nodes[1].task).toEqual({ text: 'pending local text' })
      } else if (guard === 'terminal') {
        expect(durable.workspaces[0].nodes[0].position).toEqual({ x: 100, y: 100 })
      }
    } finally {
      hook.unmount()
    }
  },
)
