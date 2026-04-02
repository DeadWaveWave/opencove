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
})
