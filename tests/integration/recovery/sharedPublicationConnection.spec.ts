import { afterEach, expect, it, vi } from 'vitest'
import { createAppError } from '@shared/errors/appError'
import {
  reportWorkerConnectionFailure,
  clearWorkerConnectionFailure,
} from '@app/renderer/shell/hooks/workerSync/workerConnectionState'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import {
  writeSharedPersistedState,
  markPersistedStateAsSynced,
} from '@contexts/workspace/presentation/renderer/utils/persistence/sharedPublication'
import {
  writePersistedState,
  writeRawPersistedState,
} from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import {
  applyLocalViewStateToPersistedState,
  persistLocalViewStateFromAppState,
} from '@contexts/workspace/presentation/renderer/utils/persistence/viewState'
import { stripPersistedAppViewState } from '@shared/sync/canonicalizePersistedAppState'
import { fixture } from '../../support/convergence/fixture'
import { localViewImage, withLocalViews } from '../../support/convergence/localViews'
import { installMockStorage } from '../../support/persistenceTestStorage'

const original = {
  api: window.opencoveApi,
  storage: window.localStorage,
  app: useAppStore.getState(),
}
afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original.api })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: original.storage })
  useAppStore.setState(original.app, true)
})
it.each(['shared', 'ordinary', 'raw'] as const)(
  'blocks %s publication until connection recovery while preserving explicit local views',
  async route => {
    const storage = installMockStorage()
    const initial = withLocalViews(fixture(true))
    persistLocalViewStateFromAppState(initial)
    const write = vi.fn(async () => ({ ok: true as const, bytes: 1, revision: 2 }))
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { persistence: { writeAppState: write, writeWorkspaceStateRaw: write } },
    })
    reportWorkerConnectionFailure(
      createAppError('agent.managed_launch_rejected', {
        details: { reason: 'workerUpgradeRequired' },
      }),
    )
    const candidate = structuredClone(initial)
    candidate.workspaces[0].name = 'Unpublished rename'
    candidate.workspaces[0].viewport = { x: 71, y: -32, zoom: 1.7 }
    const save = () =>
      route === 'ordinary'
        ? writePersistedState(candidate)
        : route === 'raw'
          ? writeRawPersistedState(JSON.stringify(candidate))
          : writeSharedPersistedState(stripPersistedAppViewState(candidate))
    const localWrite = vi.spyOn(storage, 'setItem')
    expect(await save()).toMatchObject({
      ok: false,
      outcome: 'notSubmitted',
      error: { details: { reason: 'workerUpgradeRequired' } },
    })
    expect(write).not.toHaveBeenCalled()
    expect(localViewImage(applyLocalViewStateToPersistedState(initial))).toEqual(
      localViewImage(route === 'ordinary' ? candidate : initial),
    )
    expect(localWrite).toHaveBeenCalledTimes(route === 'ordinary' ? 1 : 0)
    localWrite.mockClear()
    markPersistedStateAsSynced(stripPersistedAppViewState(initial), 1)
    expect(localWrite).not.toHaveBeenCalled()
    clearWorkerConnectionFailure()
    expect(await save()).toMatchObject({ ok: true })
    expect(write).toHaveBeenCalledTimes(1)
    expect(localViewImage(applyLocalViewStateToPersistedState(initial))).toEqual(
      localViewImage(route === 'ordinary' ? candidate : initial),
    )
    expect(localWrite).toHaveBeenCalledTimes(route === 'ordinary' ? 1 : 0)
  },
)
