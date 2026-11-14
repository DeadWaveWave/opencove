import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { useHydrateAppState } from '@app/renderer/shell/hooks/useHydrateAppState'
import { usePersistedAppState } from '@app/renderer/shell/hooks/usePersistedAppState'
import { useAppQuitPersistenceFlush } from '@app/renderer/shell/hooks/useAppQuitPersistenceFlush'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { flushScheduledPersistedStateWriteAsync } from '@contexts/workspace/presentation/renderer/utils/persistence/schedule'
import { getPendingPublication } from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import { persistLocalViewStateFromAppState } from '@contexts/workspace/presentation/renderer/utils/persistence/viewState'
import { stripPersistedAppViewState } from '@shared/sync/canonicalizePersistedAppState'
import { fixture } from '../../support/convergence/fixture'
import { Server } from '../../support/convergence/server'
import { installMockStorage } from '../../support/persistenceTestStorage'

// Only native provider launch is outside this renderer persistence contract.
vi.mock('@app/renderer/shell/hooks/useHydrateAppState.helpers', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@app/renderer/shell/hooks/useHydrateAppState.helpers')
  >()),
  prepareWorkspaceRuntimeNodes: async () => {},
}))

const original = {
  api: window.opencoveApi,
  app: useAppStore.getState(),
  storage: window.localStorage,
}
afterEach(async () => {
  cleanup()
  await flushScheduledPersistedStateWriteAsync()
  useAppStore.setState(original.app, true)
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original.api })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: original.storage })
  vi.unstubAllGlobals()
})
function produce() {
  const s = useAppStore.getState()
  return toPersistedState(s.workspaces, s.activeWorkspaceId, s.agentSettings)
}
function views(state: PersistedAppState) {
  return {
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: Object.fromEntries(
      state.workspaces.map(w => [
        w.id,
        {
          viewport: w.viewport,
          activeSpaceId: w.activeSpaceId,
          isMinimapVisible: w.isMinimapVisible,
        },
      ]),
    ),
  }
}
function useClient() {
  const { workspaces, activeWorkspaceId, agentSettings, setAgentSettings } = useAppStore()
  const hydration = useHydrateAppState({
    activeWorkspaceId,
    setAgentSettings,
  })
  const persistence = usePersistedAppState({
    workspaces,
    activeWorkspaceId,
    agentSettings,
    isHydrated: hydration.isHydrated,
    producePersistedState: produce,
  })
  useAppQuitPersistenceFlush({ enabled: hydration.isHydrated })
  return { ...hydration, ...persistence }
}
function workspace(id: string) {
  return ensurePersistedWorkspace({
    id,
    name: id,
    path: '/tmp/' + id,
    nodes: [],
    viewport: { x: -713, y: 204, zoom: 0.75 },
    isMinimapVisible: false,
    activeSpaceId: 'work',
    spaces: [
      { id: 'inbox', name: 'Inbox', nodeIds: [] },
      { id: 'work', name: 'Work', nodeIds: [] },
    ],
  })!
}
function setup() {
  installMockStorage()
  const state = fixture(true)
  Object.assign(state.workspaces[0], {
    viewport: { x: -641, y: 237, zoom: 1.25 },
    activeSpaceId: 'second',
    isMinimapVisible: false,
  })
  const server = new Server(state, 'committed')
  let quit!: () => Promise<void>
  const boot = () => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        meta: { isTest: true, runtime: 'browser' },
        persistence: server.api('web'),
        lifecycle: {
          onRequestPersistFlush: (listener: typeof quit) => {
            quit = listener
            return () => {}
          },
        },
      },
    })
    useAppStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      agentSettings: DEFAULT_AGENT_SETTINGS,
      persistNotice: null,
    })
    return renderHook(useClient)
  }
  return { state, server, boot, quit: () => quit() }
}

it('keeps captured local views through owned identity rejection, quit repair and cold hydration', async () => {
  const t = setup()
  t.state.workspaces.push(workspace('other'))
  t.state.activeWorkspaceId = 'other'
  persistLocalViewStateFromAppState(t.state)
  Object.assign(t.state, stripPersistedAppViewState(t.state))
  const client = t.boot()
  await waitFor(() => expect(client.result.current.isHydrated).toBe(true))
  const expected = views(produce())
  t.server.response = 'identity'
  await act(async () => {
    useAppStore.setState(state => ({
      workspaces: (ws =>
        ws.map(w => (w.id === 'project' ? { ...w, name: 'Legitimate rename' } : w)))(
        state.workspaces,
      ),
    }))
  })
  await act(async () => {
    client.result.current.flushPersistNow()
    expect(await flushScheduledPersistedStateWriteAsync()).toBe(false)
  })
  expect(getPendingPublication()).toMatchObject({ kind: 'rejected-rebase' })
  await act(async () => {
    await t.quit()
  })
  expect(t.server.writes).toBe(2)
  expect(t.server.read().state!.workspaces[0].name).toBe('Legitimate rename')
  client.unmount()
  const cold = t.boot()
  await waitFor(() => expect(cold.result.current.isHydrated).toBe(true))
  expect(views(produce())).toEqual(expected)
  expect(produce().workspaces[0].name).toBe('Legitimate rename')
})

it('fills imported hydration views missing from an existing map without changing established local views', async () => {
  const t = setup()
  const initial = t.boot()
  await waitFor(() => expect(initial.result.current.isHydrated).toBe(true))
  const established = views(produce())
  initial.unmount()
  const imported = t.server.read().state!
  imported.workspaces[0].viewport = { x: 999, y: 888, zoom: 2 }
  imported.workspaces[0].activeSpaceId = 'space'
  imported.workspaces[0].isMinimapVisible = true
  imported.workspaces.push(workspace('imported'))
  imported.activeWorkspaceId = 'imported'
  expect(
    await t.server.api('web').writeWorkspaceStateRaw({ raw: JSON.stringify(imported) }),
  ).toMatchObject({ ok: true })
  const hydrated = t.boot()
  await waitFor(() => expect(hydrated.result.current.isHydrated).toBe(true))
  const expected = views(produce())
  expect(expected.workspaces.project).toEqual(established.workspaces.project)
  expect(expected.activeWorkspaceId).toBe(established.activeWorkspaceId)
  expect(expected.workspaces.imported).toEqual(views(imported).workspaces.imported)
  expect(t.server.writes).toBe(1) // Initial hydration is deliberately not autosaved.
  hydrated.unmount() // A Web close has no Electron quit handshake or ordinary edit.

  // Another client's ordinary save strips its own views from the shared wire state.
  expect(
    await t.server
      .api('web')
      .writeAppState({ state: stripPersistedAppViewState(t.server.read().state!) }),
  ).toMatchObject({ ok: true })
  const cold = t.boot()
  await waitFor(() => expect(cold.result.current.isHydrated).toBe(true))
  expect(views(produce())).toEqual(expected)
  expect(t.server.writes).toBe(2)
})
