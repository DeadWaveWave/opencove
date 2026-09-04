import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  writeConnectionFile: vi.fn(),
  removeConnectionFile: vi.fn(async () => undefined),
  beginShutdown: vi.fn(),
  runtimeDispose: vi.fn(async () => undefined),
  webAccessDispose: vi.fn(async () => undefined),
}))

vi.mock('../../../src/app/main/controlSurface/http/connectionFile', () => ({
  writeConnectionFile: mocks.writeConnectionFile,
  removeConnectionFile: mocks.removeConnectionFile,
}))
vi.mock('../../../src/app/main/controlSurface/controlSurfaceHttpRuntime', () => ({
  createControlSurfaceHttpRuntime: () => ({
    token: 'token',
    appVersion: 'test',
    ready: Promise.resolve(),
    beginShutdown: mocks.beginShutdown,
    registerHandlers: vi.fn(),
    listen: () => ({
      ready: Promise.resolve({
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 16661,
      }),
    }),
    dispose: mocks.runtimeDispose,
  }),
}))
vi.mock('../../../src/app/worker/workerWebAccessRuntime', () => ({
  createWorkerWebAccessRuntime: () => ({
    ready: Promise.resolve({ state: 'disabled', generation: 0, drainingGenerations: [] }),
    status: () => ({ state: 'disabled', generation: 0, drainingGenerations: [] }),
    dispose: mocks.webAccessDispose,
  }),
}))
vi.mock('../../../src/app/worker/workerConfigurationOwner', () => ({
  createWorkerConfigurationOwner: () => ({}),
}))
vi.mock('../../../src/app/worker/workerConfigurationHandlers', () => ({
  registerWorkerConfigurationHandlers: vi.fn(),
}))
vi.mock('../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfig', () => ({
  mutateHomeWorkerConfigFile: vi.fn(),
}))

import { createDesktopManagedControlSurface } from '../../../src/app/worker/desktopManagedControlSurface'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('Desktop-managed Control Surface shutdown', () => {
  it('freezes runtime admission synchronously before awaiting connection IO', async () => {
    const writeCanFinish = deferred()
    const writeStarted = deferred()
    mocks.writeConnectionFile.mockImplementation(async () => {
      writeStarted.resolve()
      await writeCanFinish.promise
    })
    const server = createDesktopManagedControlSurface({
      server: {
        userDataPath: '/tmp/opencove-desktop-managed-shutdown',
        approvedWorkspaces: {} as never,
        ptyRuntime: {} as never,
      },
      initialConfig: {
        version: 1,
        mode: 'local',
        remote: null,
        webUi: {
          enabled: false,
          port: null,
          exposeOnLan: false,
          passwordHash: null,
        },
        updatedAt: null,
      },
    })
    await writeStarted.promise

    const disposing = server.dispose()

    expect(mocks.beginShutdown).toHaveBeenCalledOnce()
    expect(mocks.removeConnectionFile).not.toHaveBeenCalled()
    writeCanFinish.resolve()
    await disposing
    expect(mocks.webAccessDispose).toHaveBeenCalledOnce()
    expect(mocks.runtimeDispose).toHaveBeenCalledOnce()
  })
})
