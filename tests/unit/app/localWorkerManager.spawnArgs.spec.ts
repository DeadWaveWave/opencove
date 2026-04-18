import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/mock/user-data',
    getAppPath: () => '/mock/app-path',
  },
}))

describe('local worker manager spawn args', () => {
  it('includes parent pid flag', async () => {
    vi.resetModules()
    const { buildLocalWorkerSpawnArgs } =
      await import('../../../src/app/main/worker/localWorkerManager')

    const args = buildLocalWorkerSpawnArgs({
      workerScriptPath: '/mock/app-path/out/main/worker.js',
      userDataPath: '/mock/user-data',
      parentPid: 1234,
      bindHostname: '127.0.0.1',
      advertiseHostname: '127.0.0.1',
      port: 0,
      enableWebUi: true,
      webUiPasswordHash: null,
    })

    expect(args).toEqual([
      '/mock/app-path/out/main/worker.js',
      '--parent-pid',
      '1234',
      '--hostname',
      '127.0.0.1',
      '--port',
      '0',
      '--user-data',
      '/mock/user-data',
    ])
  })

  it('includes advertise hostname and password hash when configured', async () => {
    vi.resetModules()
    const { buildLocalWorkerSpawnArgs } =
      await import('../../../src/app/main/worker/localWorkerManager')

    const args = buildLocalWorkerSpawnArgs({
      workerScriptPath: '/mock/app-path/out/main/worker.js',
      userDataPath: '/mock/user-data',
      parentPid: 1234,
      bindHostname: '0.0.0.0',
      advertiseHostname: '127.0.0.1',
      port: 0,
      enableWebUi: true,
      webUiPasswordHash: 'scrypt:abc:def',
    })

    expect(args).toEqual([
      '/mock/app-path/out/main/worker.js',
      '--parent-pid',
      '1234',
      '--hostname',
      '0.0.0.0',
      '--port',
      '0',
      '--user-data',
      '/mock/user-data',
      '--advertise-hostname',
      '127.0.0.1',
      '--web-ui-password-hash',
      'scrypt:abc:def',
    ])
  })

  it('includes disable flag when web ui is disabled', async () => {
    vi.resetModules()
    const { buildLocalWorkerSpawnArgs } =
      await import('../../../src/app/main/worker/localWorkerManager')

    const args = buildLocalWorkerSpawnArgs({
      workerScriptPath: '/mock/app-path/out/main/worker.js',
      userDataPath: '/mock/user-data',
      parentPid: 1234,
      bindHostname: '127.0.0.1',
      advertiseHostname: '127.0.0.1',
      port: 0,
      enableWebUi: false,
      webUiPasswordHash: null,
    })

    expect(args).toContain('--disable-web-ui')
  })
})
