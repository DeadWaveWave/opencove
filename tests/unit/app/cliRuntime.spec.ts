import { describe, expect, it } from 'vitest'

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
