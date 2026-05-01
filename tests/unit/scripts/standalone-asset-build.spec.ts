import { describe, expect, it, vi } from 'vitest'
import {
  resolvePnpmCommand,
  runStandaloneAssetBuild,
} from '../../../scripts/lib/standalone-asset-build.mjs'

describe('standalone asset build script', () => {
  it('uses the Windows pnpm shim and disables signing auto-discovery for electron-builder', () => {
    const spawnSyncImpl = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 })

    const env = { PATH: 'C:\\pnpm' }
    const rootDir = '/repo'

    const result = runStandaloneAssetBuild({
      spawnSyncImpl,
      platform: 'win32',
      env,
      cwd: rootDir,
      stdio: 'pipe',
      rootDir,
    })

    expect(result.status).toBe(0)
    expect(resolvePnpmCommand('win32')).toBe('pnpm.cmd')
    expect(spawnSyncImpl).toHaveBeenCalledTimes(2)
    expect(spawnSyncImpl).toHaveBeenNthCalledWith(
      1,
      'pnpm.cmd',
      ['exec', 'electron-builder', '--dir', '--publish', 'never'],
      expect.objectContaining({
        cwd: rootDir,
        shell: true,
        stdio: 'pipe',
        env: expect.objectContaining({
          PATH: 'C:\\pnpm',
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        }),
      }),
    )
    expect(spawnSyncImpl).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      ['/repo/scripts/create-standalone-server-bundle.mjs'],
      expect.objectContaining({
        cwd: rootDir,
        shell: false,
        stdio: 'pipe',
        env,
      }),
    )
  })

  it('stops before bundling when electron-builder fails', () => {
    const spawnSyncImpl = vi.fn().mockReturnValueOnce({ status: 1 })

    const result = runStandaloneAssetBuild({
      spawnSyncImpl,
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      cwd: '/repo',
      stdio: 'pipe',
      rootDir: '/repo',
    })

    expect(result.status).toBe(1)
    expect(resolvePnpmCommand('linux')).toBe('pnpm')
    expect(spawnSyncImpl).toHaveBeenCalledTimes(1)
  })
})
