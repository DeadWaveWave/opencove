import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(() => '/mock/user-data'),
  ensureHomeWorkerConfig: vi.fn(),
  readHomeWorkerConfig: vi.fn(),
  startLocalWorker: vi.fn(),
  resolveControlSurfaceConnectionInfoFromUserData: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => mocks.getPath(name),
  },
}))

vi.mock('../../../src/app/main/worker/homeWorkerConfig', () => ({
  createDefaultHomeWorkerConfig: vi.fn(() => ({
    version: 1,
    mode: 'local',
    remote: null,
    webUi: {
      enabled: false,
      port: null,
      exposeOnLan: false,
      passwordSet: false,
    },
    updatedAt: null,
  })),
  ensureHomeWorkerConfig: (...args: unknown[]) => mocks.ensureHomeWorkerConfig(...args),
  readHomeWorkerConfig: (...args: unknown[]) => mocks.readHomeWorkerConfig(...args),
}))

vi.mock('../../../src/app/main/worker/localWorkerManager', () => ({
  startLocalWorker: (...args: unknown[]) => mocks.startLocalWorker(...args),
}))

vi.mock('../../../src/app/main/controlSurface/remote/resolveControlSurfaceConnectionInfo', () => ({
  resolveControlSurfaceConnectionInfoFromUserData: (...args: unknown[]) =>
    mocks.resolveControlSurfaceConnectionInfoFromUserData(...args),
}))

describe('resolveHomeWorkerEndpoint', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.getPath.mockReset()
    mocks.getPath.mockReturnValue('/mock/user-data')
    mocks.ensureHomeWorkerConfig.mockReset()
    mocks.readHomeWorkerConfig.mockReset()
    mocks.startLocalWorker.mockReset()
    mocks.resolveControlSurfaceConnectionInfoFromUserData.mockReset()
    mocks.resolveControlSurfaceConnectionInfoFromUserData.mockResolvedValue(null)
  })

  it('falls back to desktop mode when local worker startup throws', async () => {
    mocks.ensureHomeWorkerConfig.mockResolvedValue({
      version: 1,
      mode: 'local',
      remote: null,
      webUi: {
        enabled: false,
        port: null,
        exposeOnLan: false,
        passwordSet: false,
      },
      updatedAt: null,
    })
    mocks.startLocalWorker.mockRejectedValue(new Error('worker crashed before ready'))

    const { resolveHomeWorkerEndpoint } =
      await import('../../../src/app/main/worker/resolveHomeWorkerEndpoint')

    const resolved = await resolveHomeWorkerEndpoint({
      allowConfig: true,
      allowStandaloneMode: false,
    })

    expect(resolved.config.mode).toBe('local')
    expect(resolved.effectiveMode).toBe('standalone')
    expect(resolved.endpoint).toBeNull()
    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Failed to start local worker: Error: worker crashed before ready'),
        'Home worker mode is local but worker did not start.',
      ]),
    )
  })
})
