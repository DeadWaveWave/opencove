import { describe, expect, it, vi } from 'vitest'

describe('cli runtime discovery', () => {
  it('recognizes an extracted standalone app from its colocated runtime manifest', async () => {
    const { resolveCliRuntime } = await import('../../../src/app/cli/runtime.mjs')

    expect(
      resolveCliRuntime({
        cliDirectory: '/bundle/app/src/app/cli',
        resourcesPath: null,
        existsSyncImpl: (candidate: string) => candidate === '/bundle/opencove-runtime.env',
        readFileSyncImpl: () =>
          'OPENCOVE_NODE_RELATIVE_PATH=runtime/node/bin/node\nOPENCOVE_CLI_SCRIPT_RELATIVE_PATH=app/src/app/cli/opencove.mjs\n',
      }),
    ).toEqual({
      kind: 'standalone',
      appRoot: '/bundle/app',
      nodeExecutablePath: '/bundle/runtime/node/bin/node',
      workerScriptPath: '/bundle/app/out/main/worker.js',
    })
  })
})

describe('cli runtime electron binary resolution', () => {
  it('uses process.execPath when already running inside Electron', async () => {
    const { resolveElectronBinaryForWorkerStart } = await import('../../../src/app/cli/runtime.mjs')

    await expect(
      resolveElectronBinaryForWorkerStart({
        processObject: {
          execPath: '/Applications/OpenCove.app/Contents/MacOS/OpenCove',
          versions: { electron: '35.7.5' },
        },
        importElectron: async () => {
          throw new Error('should not import electron')
        },
      }),
    ).resolves.toBe('/Applications/OpenCove.app/Contents/MacOS/OpenCove')
  })

  it('falls back to the electron package when running from plain node', async () => {
    const { resolveElectronBinaryForWorkerStart } = await import('../../../src/app/cli/runtime.mjs')

    await expect(
      resolveElectronBinaryForWorkerStart({
        processObject: {
          execPath: '/usr/local/bin/node',
          versions: {},
        },
        importElectron: async () => ({ default: '/path/to/electron' }),
      }),
    ).resolves.toBe('/path/to/electron')
  })
})

describe('worker runtime selection', () => {
  it('uses the current pure Node executable for a standalone bundle without importing Electron', async () => {
    const { resolveWorkerRuntimeForStart } = await import('../../../src/app/cli/runtime.mjs')
    const importElectron = vi.fn()

    await expect(
      resolveWorkerRuntimeForStart({
        cliRuntime: {
          kind: 'standalone',
          nodeExecutablePath: '/bundle/runtime/node/bin/node',
        },
        processObject: {
          execPath: '/bundle/runtime/node/bin/node',
          versions: { node: '22.22.0' },
        },
        importElectron,
        realpathSyncImpl: (candidate: string) => candidate,
      }),
    ).resolves.toEqual({ kind: 'node', executablePath: '/bundle/runtime/node/bin/node' })
    expect(importElectron).not.toHaveBeenCalled()
  })

  it('fails closed when a standalone entry is accidentally launched by Electron', async () => {
    const { resolveWorkerRuntimeForStart } = await import('../../../src/app/cli/runtime.mjs')

    await expect(
      resolveWorkerRuntimeForStart({
        cliRuntime: { kind: 'standalone', nodeExecutablePath: '/bundle/runtime/node/bin/node' },
        processObject: {
          execPath: '/bundle/runtime/OpenCove',
          versions: { node: '22.22.0', electron: '41.5.1' },
        },
      }),
    ).rejects.toThrow('standalone worker requires the bundled Node runtime')
  })

  it('fails closed when a standalone entry is launched by a host Node executable', async () => {
    const { resolveWorkerRuntimeForStart } = await import('../../../src/app/cli/runtime.mjs')

    await expect(
      resolveWorkerRuntimeForStart({
        cliRuntime: { kind: 'standalone', nodeExecutablePath: '/bundle/runtime/node/bin/node' },
        processObject: {
          execPath: '/usr/local/bin/node',
          versions: { node: '22.22.0' },
        },
        realpathSyncImpl: (candidate: string) => candidate,
      }),
    ).rejects.toThrow('refusing to fall back to another runtime')
  })

  it('keeps the existing Electron path for source and Desktop runtimes', async () => {
    const { resolveWorkerRuntimeForStart } = await import('../../../src/app/cli/runtime.mjs')

    await expect(
      resolveWorkerRuntimeForStart({
        cliRuntime: { kind: 'source' },
        processObject: { execPath: '/usr/bin/node', versions: { node: '22.22.0' } },
        importElectron: async () => ({ default: '/repo/node_modules/electron/dist/electron' }),
      }),
    ).resolves.toEqual({
      kind: 'electron',
      executablePath: '/repo/node_modules/electron/dist/electron',
    })
  })

  it('removes Electron-only variables from the standalone worker environment', async () => {
    const { createWorkerSpawnEnvironment } = await import('../../../src/app/cli/runtime.mjs')

    expect(
      createWorkerSpawnEnvironment('node', {
        PATH: '/bundle/runtime/node/bin',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_DISABLE_SANDBOX: '1',
      }),
    ).toEqual({
      PATH: '/bundle/runtime/node/bin',
      OPENCOVE_TRUST_PROCESS_ENV: '1',
    })
  })
})
