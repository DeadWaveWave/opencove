import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  invoke: vi.fn(),
  setLocal: vi.fn(),
  readLocal: vi.fn(),
  ensureLocal: vi.fn(),
  withLease: vi.fn(),
}))

vi.mock('../../../src/app/main/worker/localWorkerManager', () => ({
  resolveOwnedLocalWorkerConfigurationState: mocks.resolveOwner,
}))
vi.mock('../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease', () => ({
  withHomeWorkerConfigLease: mocks.withLease,
}))
vi.mock('../../../src/app/main/worker/localWorkerConfigurationClient', () => ({
  invokeLocalWorkerConfiguration: mocks.invoke,
}))
vi.mock('../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfig', () => ({
  readHomeWorkerConfig: mocks.readLocal,
  ensureHomeWorkerConfig: mocks.ensureLocal,
}))
vi.mock(
  '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigMutations',
  () => ({
    setHomeWorkerConfig: mocks.setLocal,
    setHomeWorkerWebUiSettings: mocks.setLocal,
    setHomeWorkerWebUiSecurity: mocks.setLocal,
  }),
)

import { createHomeWorkerConfigurationRouter } from '../../../src/app/main/worker/homeWorkerConfigurationRouter'

const config = {
  version: 1 as const,
  mode: 'local' as const,
  remote: null,
  webUi: { enabled: false, port: null, exposeOnLan: false, passwordSet: false },
  updatedAt: null,
}
const connection = {
  version: 1,
  pid: 1,
  hostname: '127.0.0.1',
  port: 16661,
  token: 'token',
  createdAt: '2026-08-31T00:00:00.000Z',
  appVersion: 'test',
  startedBy: 'desktop' as const,
}

function createRouter() {
  return createHomeWorkerConfigurationRouter({
    userDataPath: '/tmp/opencove-router-test',
    configOptions: {},
    ensureMissingConfig: false,
  })
}

describe('Home Worker configuration router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readLocal.mockResolvedValue(config)
    mocks.setLocal.mockResolvedValue(config)
    mocks.withLease.mockImplementation(async (_path, operation) => await operation())
  })

  it('fails closed instead of creating a second writer for an unreachable owned Worker', async () => {
    mocks.resolveOwner.mockResolvedValue({ state: 'unreachable', connection })

    await expect(
      createRouter().setWebUiSettings({ enabled: true, port: null }),
    ).rejects.toMatchObject({ code: 'worker.unavailable' })
    expect(mocks.setLocal).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('rejects mutation while the owned Worker is still starting', async () => {
    mocks.resolveOwner.mockResolvedValue({ state: 'starting', connection: null })

    await expect(
      createRouter().setWebUiSettings({ enabled: true, port: null }),
    ).rejects.toMatchObject({ code: 'worker.unavailable' })
    expect(mocks.setLocal).not.toHaveBeenCalled()
  })

  it('rejects Desktop hot apply while a CLI-managed Worker is active', async () => {
    mocks.resolveOwner.mockResolvedValue({ state: 'external', connection })

    await expect(
      createRouter().setWebUiSettings({ enabled: true, port: null }),
    ).rejects.toMatchObject({ code: 'worker.unavailable' })
    expect(mocks.setLocal).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('writes locally only when no Worker process owns the runtime', async () => {
    mocks.resolveOwner.mockResolvedValue({ state: 'absent', connection: null })

    await expect(createRouter().setWebUiSettings({ enabled: true, port: null })).resolves.toBe(
      config,
    )
    expect(mocks.setLocal).toHaveBeenCalledOnce()
  })

  it('rechecks ownership inside the offline mutation lease', async () => {
    mocks.resolveOwner
      .mockResolvedValueOnce({ state: 'absent', connection: null })
      .mockResolvedValueOnce({ state: 'ready', connection })
    mocks.invoke
      .mockResolvedValueOnce({
        config,
        webAccess: { state: 'disabled', generation: 0, drainingGenerations: [] },
      })
      .mockResolvedValueOnce({
        config,
        webAccess: { state: 'disabled', generation: 0, drainingGenerations: [] },
      })

    await expect(createRouter().setWebUiSettings({ enabled: true, port: null })).resolves.toBe(
      config,
    )

    expect(mocks.withLease).toHaveBeenCalledOnce()
    expect(mocks.setLocal).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      connection,
      expect.objectContaining({ id: 'worker.webAccess.setSettings' }),
    )
  })

  it('preserves an explicit degraded Web listener status in the read snapshot', async () => {
    mocks.resolveOwner.mockResolvedValue({ state: 'ready', connection })
    const degraded = {
      state: 'degraded' as const,
      generation: 4,
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 16662,
      passwordRequired: false,
      error: 'Listener restoration pending.',
      drainingGenerations: [],
    }
    mocks.invoke.mockResolvedValueOnce({ config, webAccess: degraded })

    await expect(createRouter().readSnapshot()).resolves.toEqual({
      config,
      webAccess: degraded,
    })
  })

  it('routes mutations through a ready owned Worker', async () => {
    mocks.resolveOwner.mockResolvedValue({ state: 'ready', connection })
    mocks.invoke
      .mockResolvedValueOnce({
        config,
        webAccess: { state: 'disabled', generation: 0, drainingGenerations: [] },
      })
      .mockResolvedValueOnce({
        config,
        webAccess: { state: 'disabled', generation: 0, drainingGenerations: [] },
      })

    await expect(createRouter().setWebUiSettings({ enabled: true, port: null })).resolves.toBe(
      config,
    )
    expect(mocks.setLocal).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      connection,
      expect.objectContaining({ id: 'worker.webAccess.setSettings' }),
    )
  })
})
