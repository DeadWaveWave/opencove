import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkerSyncStateUpdates } from '../../../src/app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toShellWorkspaceState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { useCanvasCollapseStore } from '../../../src/contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  schedulePersistedStateWrite,
  flushScheduledPersistedStateWriteAsync,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/schedule'
import type { PersistedAppState } from '../../../src/contexts/workspace/presentation/renderer/types'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'

const originalState = useAppStore.getState()
afterEach(async () => {
  await flushScheduledPersistedStateWriteAsync()
  useAppStore.setState(originalState, true)
  useCanvasCollapseStore.setState({ workspaces: {} })
})

function setup(collapsed: boolean) {
  const workspace = toShellWorkspaceState(
    ensurePersistedWorkspace({
      id: 'collapse-project',
      name: 'Collapse project',
      path: '/tmp/collapse-project',
      nodes: [],
      spaces: [],
    })!,
  )
  useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id })
  const edit = (value: boolean) =>
    useCanvasCollapseStore.getState().update(workspace.id, () => ({
      collapsedNodeIds: value ? { document: true } : {},
      collapsedSpaceIds: {},
    }))
  edit(collapsed)
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
  return {
    workspace,
    edit,
    produce,
    releaseRead,
    readBarrier,
    readAppState,
    hook,
    emit,
    shared: () => sharedState,
  }
}

it.each([false, true])(
  'preserves disclosure changed from %s while a shared read is pending',
  async initial => {
    const test = setup(initial)
    try {
      act(() => test.emit({ type: 'app_state.updated', operationId: 'mount.create', revision: 10 }))
      await waitFor(() => expect(test.readAppState).toHaveBeenCalledOnce())
      await act(async () => {
        test.edit(!initial)
        schedulePersistedStateWrite(test.produce, { delayMs: 10_000 })
        test.releaseRead()
        await test.readBarrier
      })
      expect(test.produce().workspaces[0]!.collapsedNodeIds).toEqual(initial ? [] : ['document'])
      await act(async () => {
        await flushScheduledPersistedStateWriteAsync()
      })
      expect(test.shared().workspaces[0]!.collapsedNodeIds).toEqual(initial ? [] : ['document'])
    } finally {
      test.releaseRead()
      test.hook.unmount()
    }
  },
)

it('applies an accepted remote disclosure update even when workspace geometry is unchanged', async () => {
  const test = setup(false)
  test.shared().workspaces[0]!.collapsedNodeIds = ['document']
  try {
    act(() => test.emit({ type: 'app_state.updated', operationId: 'mount.create', revision: 10 }))
    await waitFor(() => expect(test.readAppState).toHaveBeenCalledOnce())
    await act(async () => {
      test.releaseRead()
      await test.readBarrier
    })
    expect(test.produce().workspaces[0]!.collapsedNodeIds).toEqual(['document'])
  } finally {
    test.releaseRead()
    test.hook.unmount()
  }
})

it('does not apply disclosure from a read completed after the sync owner unmounts', async () => {
  const test = setup(false)
  test.shared().workspaces[0]!.collapsedNodeIds = ['document']
  try {
    act(() => test.emit({ type: 'app_state.updated', operationId: 'mount.create', revision: 10 }))
    await waitFor(() => expect(test.readAppState).toHaveBeenCalledOnce())
    test.hook.unmount()
    await act(async () => {
      test.releaseRead()
      await test.readBarrier
    })
    expect(test.produce().workspaces[0]!.collapsedNodeIds).toEqual([])
  } finally {
    test.releaseRead()
    test.hook.unmount()
  }
})
