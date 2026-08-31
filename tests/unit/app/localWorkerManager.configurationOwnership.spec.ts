import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerConnectionInfoDto } from '../../../src/shared/contracts/dto'

const mocks = vi.hoisted(() => ({
  connection: null as WorkerConnectionInfoDto | null,
  isReusable: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/opencove-owner-test',
    getAppPath: () => '/tmp/opencove-owner-test',
    isPackaged: false,
  },
}))
vi.mock('../../../src/app/main/controlSurface/remote/resolveControlSurfaceConnectionInfo', () => ({
  resolveControlSurfaceConnectionInfoFromUserData: vi.fn(async () => mocks.connection),
}))
vi.mock('../../../src/app/main/worker/localWorkerCompatibility', () => ({
  resolveLocalWorkerReusePolicy: (candidate: WorkerConnectionInfoDto) => ({
    canReuse: candidate.startedBy === 'desktop' && candidate.appVersion === 'test-version',
    expectedAppVersion: 'test-version',
  }),
  isReusableLocalWorkerConnection: mocks.isReusable,
}))
vi.mock('../../../src/app/main/controlSurface/runtimeAppVersion', () => ({
  readRuntimeAppVersion: () => 'test-version',
}))

import { resolveOwnedLocalWorkerConfigurationState } from '../../../src/app/main/worker/localWorkerManager'

function createConnection(startedBy: 'cli' | 'desktop'): WorkerConnectionInfoDto {
  return {
    version: 1,
    pid: process.pid,
    hostname: '127.0.0.1',
    port: 16661,
    token: 'token',
    createdAt: '2026-08-31T00:00:00.000Z',
    appVersion: 'test-version',
    startedBy,
  }
}

describe('local Worker configuration ownership', () => {
  beforeEach(() => {
    mocks.connection = null
    mocks.isReusable.mockReset()
  })

  it('does not treat a CLI-started Worker as the Desktop configuration owner', async () => {
    mocks.connection = createConnection('cli')
    await expect(resolveOwnedLocalWorkerConfigurationState()).resolves.toEqual({
      state: 'external',
      connection: mocks.connection,
    })
    expect(mocks.isReusable).not.toHaveBeenCalled()
  })

  it('fails closed when a live owned Desktop Worker is temporarily unreachable', async () => {
    mocks.connection = createConnection('desktop')
    mocks.isReusable.mockResolvedValue(false)
    await expect(resolveOwnedLocalWorkerConfigurationState()).resolves.toEqual({
      state: 'unreachable',
      connection: mocks.connection,
    })
  })
})
