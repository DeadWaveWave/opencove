import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkerSyncStateUpdates } from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  writePersistedState,
  markPersistedStateAsSynced,
  getPendingPublication,
} from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { drainPersistedStateAtQuit } from '@contexts/workspace/presentation/renderer/utils/persistence/drain'
import { flushScheduledPersistedStateWriteAsync } from '@contexts/workspace/presentation/renderer/utils/persistence/schedule'
const original = useAppStore.getState(),
  originalApi = window.opencoveApi
const marker = { activationId: 'activation', runtimeSessionId: 'runtime' }
function setup() {
  const workspace = toShellWorkspaceState(
    ensurePersistedWorkspace({
      id: 'project',
      name: 'Project',
      path: '/tmp/project',
      nodes: [
        {
          id: 'agent',
          kind: 'agent',
          sessionId: 'runtime',
          title: 'Claude',
          width: 500,
          height: 400,
          position: { x: 0, y: 0 },
          managedClaudeResumeBindingOwnership: marker,
          agent: {
            provider: 'claude-code',
            executionDirectory: '/tmp/project',
            resumeSessionId: 'A',
            resumeSessionIdVerified: true,
          },
        },
      ],
      spaces: [],
    })!,
  )
  useAppStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id })
  const produce = () => {
    const current = useAppStore.getState()
    return toPersistedState(current.workspaces, current.activeWorkspaceId, current.agentSettings)
  }
  const base = produce(),
    canonical = structuredClone(base)
  canonical.workspaces[0].nodes[0].agent!.resumeSessionId = 'B'
  return { produce, base, canonical }
}
afterEach(async () => {
  await flushScheduledPersistedStateWriteAsync()
  useAppStore.setState(original, true)
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: originalApi })
})
it.each(['no events', 'event before response', 'edit during read'] as const)(
  'converges owned fields and retains layout with %s',
  async ordering => {
    const { produce, base, canonical } = setup()
    let finish!: () => void
    const barrier = new Promise<void>(resolve => {
      finish = resolve
    })
    const read = vi.fn(async () => {
      if (ordering === 'edit during read') {
        await barrier
      }
      return { state: canonical, revision: 3, recovery: null }
    })
    const write = vi.fn(async () => {
      if (ordering === 'event before response') {
        await barrier
      }
      return { ok: true, level: 'full', bytes: 1, revision: 3, corrected: true }
    })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { persistence: { readAppState: read, writeAppState: write } },
    })
    markPersistedStateAsSynced(base, 1)
    useAppStore.getState().setWorkspaces(previous =>
      previous.map(w => ({
        ...w,
        nodes: w.nodes.map(n => ({ ...n, position: { x: 90, y: 10 } })),
      })),
    )
    const request = writePersistedState(produce())
    if (ordering === 'event before response') {
      markPersistedStateAsSynced(canonical, 3)
      finish()
    }
    await request
    if (ordering === 'event before response') {
      expect(getPendingPublication()).toBeNull()
      return
    }
    const hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
    try {
      if (ordering === 'edit during read') {
        await waitFor(() => expect(read).toHaveBeenCalled())
        act(() =>
          useAppStore.getState().setWorkspaces(previous =>
            previous.map(w => ({
              ...w,
              nodes: w.nodes.map(n => ({ ...n, position: { x: 120, y: 20 } })),
            })),
          ),
        )
        finish()
      }
      await waitFor(() =>
        expect(useAppStore.getState().workspaces[0].nodes[0].data.agent?.resumeSessionId).toBe('B'),
      )
      if (ordering === 'edit during read') {
        expect(useAppStore.getState().workspaces[0].nodes[0].position.x).toBe(120)
      }
      expect(write).toHaveBeenCalledTimes(1)
    } finally {
      hook.unmount()
    }
  },
)
it('repairs an identity rejection and drains the captured layout on immediate quit without events', async () => {
  const { produce, base, canonical } = setup()
  let durable = canonical
  const write = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      reason: 'io',
      error: {
        code: 'persistence.owned_node_identity_conflict',
        details: { nodeId: 'agent', field: 'agent.provider', reason: 'incompatible' },
      },
    })
    .mockImplementation(async ({ state }) => {
      durable = state
      return { ok: true, level: 'full', bytes: 1, revision: 4, corrected: false }
    })
  const read = vi.fn(async () => ({ state: durable, revision: 3, recovery: null }))
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: { persistence: { readAppState: read, writeAppState: write } },
  })
  markPersistedStateAsSynced(base, 1)
  const local = produce()
  local.workspaces[0].nodes[0].position.x = 150
  local.workspaces[0].nodes[0].agent!.provider = 'pi'
  expect(await writePersistedState(local)).toMatchObject({ ok: false })
  expect(await drainPersistedStateAtQuit(local)).toBe(true)
  expect(read).toHaveBeenCalledOnce()
  expect(durable.workspaces[0].nodes[0]).toMatchObject({
    position: { x: 150 },
    agent: { provider: 'claude-code', resumeSessionId: 'B' },
  })
})
it('publishes remaining edits even when canonical rebase needs no UI change', async () => {
  const { produce, base } = setup()
  const submitted = structuredClone(base)
  submitted.settings.releaseNotesSeenVersion = 'submitted'
  const write = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, level: 'full', bytes: 1, revision: 3, merged: true })
    .mockResolvedValue({ ok: true, level: 'full', bytes: 1, revision: 4, corrected: false })
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      persistence: {
        writeAppState: write,
        readAppState: vi.fn(async () => ({ state: submitted, revision: 3, recovery: null })),
      },
    },
  })
  markPersistedStateAsSynced(base, 1)
  await writePersistedState(submitted)
  useAppStore.setState({
    agentSettings: { ...submitted.settings, releaseNotesSeenVersion: 'later' },
  })
  const hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
  try {
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(write.mock.calls[1][0].state.settings.releaseNotesSeenVersion).toBe('later')
    expect(produce().settings.releaseNotesSeenVersion).toBe('later')
  } finally {
    hook.unmount()
  }
})
