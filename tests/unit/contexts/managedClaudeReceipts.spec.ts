import { withWorkerCompatibility } from '../../support/workerCompatibilityFetch'
import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserPersistenceApi } from '@app/renderer/browser/browserOpenCoveApi.persistence'
import { invokeBrowserControlSurface } from '@app/renderer/browser/browserControlSurface'
import { createRemotePersistenceStore } from '@app/main/controlSurface/remote/remotePersistenceStore'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
vi.mock('@app/renderer/browser/browserControlSurface', () => ({
  invokeBrowserControlSurface: vi.fn(),
}))
const state = {
  formatVersion: 1,
  activeWorkspaceId: null,
  workspaces: [],
  settings: DEFAULT_AGENT_SETTINGS,
}
afterEach(() => vi.unstubAllGlobals())
it.each([true, false, undefined] as const)(
  'preserves corrected receipt %s in Web and remote Desktop',
  async corrected => {
    const receipt = { revision: 2, ...(corrected === undefined ? {} : { corrected }) }
    const invoke = vi
      .mocked(invokeBrowserControlSurface)
      .mockReset()
      .mockResolvedValueOnce({ revision: 1, state })
      .mockResolvedValueOnce(receipt)
    const browser = createBrowserPersistenceApi()
    await browser.readAppState()
    expect(await browser.writeAppState({ state, baseRevision: 1 })).toMatchObject({
      ok: true,
      revision: 2,
      merged: corrected === false ? undefined : true,
      corrected,
    })
    expect(invoke).toHaveBeenCalledTimes(2)
    const values = [{ revision: 1, state }, receipt]
    const fetchMock = vi.fn(async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value: values.shift() }),
    }))
    vi.stubGlobal('fetch', withWorkerCompatibility(fetchMock as typeof fetch))
    const remote = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'test',
    }))
    await remote.readAppState()
    expect(await remote.writeAppState(state, { baseRevision: 1 })).toMatchObject({
      ok: true,
      revision: 2,
      merged: corrected === false ? undefined : true,
      corrected,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  },
)
it('returns malformed Web success as uncertain without retrying the mutation', async () => {
  const invoke = vi
    .mocked(invokeBrowserControlSurface)
    .mockReset()
    .mockResolvedValue({ revision: -1, corrected: true })
  const browser = createBrowserPersistenceApi()
  expect(await browser.writeAppState({ state })).toMatchObject({
    ok: true,
    merged: true,
    uncertain: true,
  })
  expect(invoke).toHaveBeenCalledOnce()
})
