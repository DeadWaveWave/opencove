import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkerSyncStateUpdates } from '../../../src/app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toShellWorkspaceState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'

const originalState = useAppStore.getState()
afterEach(() => useAppStore.setState(originalState, true))

it('acknowledges a local recovery publication even when its shared-state echo is suppressed', async () => {
  const persisted = ensurePersistedWorkspace({
    id: 'workspace',
    name: 'Workspace',
    path: '/tmp/workspace',
    nodes: [
      {
        id: 'terminal',
        kind: 'terminal',
        title: 'Terminal',
        sessionId: 'new-runtime',
        position: { x: 0, y: 0 },
        width: 520,
        height: 360,
      },
    ],
    spaces: [],
    activeSpaceId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
  })!
  const workspace = toShellWorkspaceState(persisted)
  workspace.nodes[0]!.data.runtimeSessionBinding = { phase: 'publishing', sessionId: 'new-runtime' }
  useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id })
  const state = toPersistedState([workspace], workspace.id)
  const readAppState = vi.fn(async () => ({ state, recovery: null }))
  let emit!: (event: SyncEventPayload) => void
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      persistence: { readAppState },
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
      window.dispatchEvent(new CustomEvent('opencove.localSyncWrite', { detail: { revision: 2 } }))
      emit({ type: 'app_state.updated', operationId: 'sync.writeState', revision: 2 })
    })
    await waitFor(() =>
      expect(
        useAppStore.getState().workspaces[0]!.nodes[0]!.data.runtimeSessionBinding,
      ).toBeUndefined(),
    )
    expect(readAppState).toHaveBeenCalledOnce()
    state.workspaces[0]!.nodes[0]!.sessionId = 'another-client-runtime'
    act(() =>
      emit({ type: 'app_state.updated', operationId: 'session.prepareOrRevive', revision: 3 }),
    )
    await waitFor(() =>
      expect(useAppStore.getState().workspaces[0]!.nodes[0]!.data.sessionId).toBe(
        'another-client-runtime',
      ),
    )
  } finally {
    hook.unmount()
  }
})
