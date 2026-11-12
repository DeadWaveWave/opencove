import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { useAppQuitPersistenceFlush } from '@app/renderer/shell/hooks/useAppQuitPersistenceFlush'
import { useHydrateAppState } from '@app/renderer/shell/hooks/useHydrateAppState'
import { useWorkerSyncStateUpdates } from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { writePersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { readPersistedStateWithMeta } from '@contexts/workspace/presentation/renderer/utils/persistence/read'
import {
  capturePublication,
  drainPersistedStateAtQuit,
} from '@contexts/workspace/presentation/renderer/utils/persistence/drain'
import { flushScheduledPersistedStateWriteAsync } from '@contexts/workspace/presentation/renderer/utils/persistence/schedule'
import { getAcceptedRevision } from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import {
  requestCanonicalRefresh,
  getCanonicalRefreshDemand,
} from '@contexts/workspace/presentation/renderer/utils/persistence/canonicalRefresh'
import { installMockStorage } from '../../support/persistenceTestStorage'

const original = {
  state: useAppStore.getState(),
  api: window.opencoveApi,
  storage: window.localStorage,
}
afterEach(async () => {
  cleanup()
  await flushScheduledPersistedStateWriteAsync()
  useAppStore.setState(original.state, true)
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original.api })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: original.storage })
})

function fixture(): PersistedAppState {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'clock-project',
    settings: structuredClone(DEFAULT_AGENT_SETTINGS),
    workspaces: [
      ensurePersistedWorkspace({
        id: 'other',
        name: 'Other',
        path: '/tmp/other',
        nodes: [],
        spaces: [],
      })!,
      ensurePersistedWorkspace({
        id: 'clock-project',
        name: 'Clock project',
        path: '/tmp/clock-project',
        viewport: { x: -650, y: -410, zoom: 0.8 },
        isMinimapVisible: false,
        activeSpaceId: 'work',
        spaces: [
          { id: 'inbox', name: 'Inbox', nodeIds: [] },
          { id: 'work', name: 'Work', nodeIds: ['clock'] },
        ],
        nodes: [
          {
            id: 'clock',
            kind: 'plugin',
            title: 'Persistent clock',
            position: { x: 1080, y: 760 },
            width: 320,
            height: 240,
            task: {
              pluginId: 'hello-clock',
              schemaVersion: 1,
              repoPath: '/tmp/clock-project',
              mountId: null,
            },
          },
        ],
      })!,
    ],
  }
}

function produce() {
  const { workspaces, activeWorkspaceId, agentSettings } = useAppStore.getState()
  return toPersistedState(workspaces, activeWorkspaceId, agentSettings)
}
function view(state: PersistedAppState) {
  const workspace = state.workspaces.find(w => w.id === 'clock-project')!
  return {
    activeWorkspaceId: state.activeWorkspaceId,
    viewport: workspace.viewport,
    isMinimapVisible: workspace.isMinimapVisible,
    activeSpaceId: workspace.activeSpaceId,
    position: workspace.nodes[0].position,
    width: workspace.nodes[0].width,
    height: workspace.nodes[0].height,
  }
}
function useColdClient() {
  const { activeWorkspaceId, setAgentSettings, setWorkspaces, setActiveWorkspaceId } = useAppStore()
  const hydration = useHydrateAppState({
    activeWorkspaceId,
    setAgentSettings,
    setWorkspaces,
    setActiveWorkspaceId,
  })
  useWorkerSyncStateUpdates({ enabled: hydration.isHydrated })
  return hydration
}
function setup() {
  installMockStorage()
  let durable: PersistedAppState | null = null
  let revision = 0
  let quit!: () => Promise<void>
  const read = vi.fn(async () => ({ state: structuredClone(durable), revision, recovery: null }))
  const write = vi.fn(async ({ state }: { state: PersistedAppState }) => {
    durable = structuredClone(state)
    return { ok: true, level: 'full', bytes: 1, revision: ++revision, corrected: false }
  })
  const connect = () => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        // A new IPC identity discards volatile publication state on every cold boot.
        persistence: { readAppState: read, writeAppState: write },
        lifecycle: {
          onRequestPersistFlush: (listener: typeof quit) => {
            quit = listener
            return () => {}
          },
        },
      },
    })
  }
  connect()
  const local = fixture()
  useAppStore.setState({
    workspaces: local.workspaces.map(w => toShellWorkspaceState(w)),
    activeWorkspaceId: local.activeWorkspaceId,
    agentSettings: local.settings,
  })
  return {
    read,
    write,
    quit: () => quit(),
    durable: () => durable!,
    externalRename: () => {
      durable!.workspaces[1].name = 'Renamed elsewhere'
      revision++
    },
    coldBoot: () => {
      connect()
      useAppStore.setState({
        workspaces: [],
        activeWorkspaceId: null,
        agentSettings: DEFAULT_AGENT_SETTINGS,
      })
      return renderHook(useColdClient)
    },
  }
}

it('keeps viewport, active selections, minimap and node geometry through save, quit and cold hydration', async () => {
  const test = setup()
  const expected = view(produce())
  expect(await writePersistedState(produce())).toMatchObject({ ok: true })
  expect(view((await readPersistedStateWithMeta()).state!)).toEqual(expected)
  // The shared payload intentionally has view placeholders; local storage must keep the real view.
  expect(test.durable().workspaces[1].viewport).toEqual({ x: 0, y: 0, zoom: 1 })
  const client = renderHook(() => useAppQuitPersistenceFlush({ enabled: true }))
  await act(async () => {
    await test.quit()
  })
  client.unmount()
  // Check the durable image at the quit boundary, before any later UI flush can repair it.
  expect(view((await readPersistedStateWithMeta()).state!)).toEqual(expected)
  const restored = test.coldBoot()
  await waitFor(() => expect(restored.result.current.isHydrated).toBe(true))
  expect(view(produce())).toEqual(expected)
  expect(test.write).toHaveBeenCalledOnce()
})

it('persists view-only changes when draining an already durable shared snapshot', async () => {
  const test = setup()
  expect(await writePersistedState(produce())).toMatchObject({ ok: true })
  useAppStore.setState(state => ({
    workspaces: state.workspaces.map(w =>
      w.id === 'clock-project'
        ? {
            ...w,
            viewport: { x: -700, y: -450, zoom: 0.9 },
            isMinimapVisible: true,
            activeSpaceId: 'inbox',
          }
        : w,
    ),
  }))
  const expected = view(produce())
  expect(await drainPersistedStateAtQuit(produce())).toBe(true)
  expect(view((await readPersistedStateWithMeta()).state!)).toEqual(expected)
  expect(test.write).toHaveBeenCalledOnce()
})

it('retains restored and newly panned view state across a post-hydration canonical refresh and another cold boot', async () => {
  const test = setup()
  await writePersistedState(produce())
  const restored = test.coldBoot()
  await waitFor(() => expect(restored.result.current.isHydrated).toBe(true))
  await act(async () => {
    useAppStore.setState(state => ({
      workspaces: state.workspaces.map(w =>
        w.id === 'clock-project'
          ? {
              ...w,
              viewport: { x: -500, y: -320, zoom: 0.7 },
            }
          : w,
      ),
    }))
    await writePersistedState(produce())
  })
  const expected = view(produce())
  test.externalRename()
  act(() => requestCanonicalRefresh({ reason: 'connect', minimumRevision: 2 }))
  await waitFor(() => expect(getCanonicalRefreshDemand()).toBeNull())
  expect(getAcceptedRevision()).toBe(2)
  expect(useAppStore.getState().workspaces[1].name).toBe('Renamed elsewhere')
  expect(view(produce())).toEqual(expected)
  expect(view((await readPersistedStateWithMeta()).state!)).toEqual(expected)
  restored.unmount()
  const next = test.coldBoot()
  await waitFor(() => expect(next.result.current.isHydrated).toBe(true))
  expect(view(produce())).toEqual(expected)
  expect(test.write).toHaveBeenCalledOnce()
})

it('does not overwrite newer local view preferences when draining an older capture', async () => {
  const test = setup()
  await writePersistedState(produce())
  const captured = capturePublication(produce())
  useAppStore.setState(state => ({
    workspaces: state.workspaces.map(w =>
      w.id === 'clock-project'
        ? {
            ...w,
            viewport: { x: -400, y: -250, zoom: 0.6 },
          }
        : w,
    ),
  }))
  await writePersistedState(produce())
  const expected = view(produce())
  expect(await drainPersistedStateAtQuit(captured)).toBe(true)
  expect(view((await readPersistedStateWithMeta()).state!)).toEqual(expected)
  expect(test.write).toHaveBeenCalledOnce()
})
