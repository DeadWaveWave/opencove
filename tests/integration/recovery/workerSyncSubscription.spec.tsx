import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkerSyncStateUpdates } from '../../../src/app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { fixture } from '../../support/convergence/fixture'
import { toShellWorkspaceState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { markPersistedStateAsSynced } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/write'
const original = useAppStore.getState(),
  originalApi = window.opencoveApi
afterEach(() => {
  useAppStore.setState(original, true)
  window.opencoveApi = originalApi
})
it('reads a commit between hydration and the Desktop listener without another event', async () => {
  const hydrated = fixture(true),
    current = structuredClone(hydrated)
  current.workspaces[0].nodes[0].agent!.resumeSessionId = 'B'
  let subscribed = false
  const read = vi.fn(async () => {
    expect(subscribed).toBe(true)
    return { state: current, revision: 2, recovery: null }
  })
  window.opencoveApi = {
    persistence: { readAppState: read },
    sync: {
      onStateUpdated: () => {
        subscribed = true
        return () => {}
      },
    },
  } as unknown as typeof window.opencoveApi
  markPersistedStateAsSynced(hydrated, 1)
  useAppStore.setState({
    workspaces: hydrated.workspaces.map(w => toShellWorkspaceState(w)),
    activeWorkspaceId: hydrated.activeWorkspaceId,
    agentSettings: hydrated.settings,
  })
  const hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
  try {
    await waitFor(() =>
      expect(useAppStore.getState().workspaces[0].nodes[0].data.agent?.resumeSessionId).toBe('B'),
    )
  } finally {
    hook.unmount()
  }
})
