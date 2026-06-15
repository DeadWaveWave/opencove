import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import {
  buildElectronViteDevEnv,
  buildElectronViteDevSpawnConfig,
  resolveSignalExitCode,
  runElectronViteDev,
} from '../../../scripts/run-electron-vite-dev.mjs'

class TestChildProcess extends EventEmitter {
  pid = 4242
  kill = vi.fn(() => true)
}

describe('run-electron-vite-dev', () => {
  it('removes Electron-as-Node control env before launching the desktop app', () => {
    const env = buildElectronViteDevEnv({
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--trace-warnings',
      PATH: '/usr/bin',
    })

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBe('--trace-warnings')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('launches electron-vite directly without giving the child terminal stdin', () => {
    const config = buildElectronViteDevSpawnConfig({
      args: ['--remoteDebuggingPort', '9333'],
      cwd: '/repo',
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        PATH: '/usr/bin',
      },
      platform: 'darwin',
    })

    expect(config.command).toBe('/repo/node_modules/.bin/electron-vite')
    expect(config.args).toEqual(['dev', '--remoteDebuggingPort', '9333'])
    expect(config.options).toEqual(
      expect.objectContaining({
        cwd: '/repo',
        detached: true,
        shell: false,
        stdio: ['ignore', 'inherit', 'inherit'],
        windowsHide: true,
      }),
    )
    expect(config.options.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(config.options.env.PATH).toBe('/usr/bin')
  })

  it('uses the Windows command shim without creating a detached process group', () => {
    const config = buildElectronViteDevSpawnConfig({
      cwd: 'C:\\repo',
      env: {},
      platform: 'win32',
    })

    expect(config.command).toBe('C:\\repo\\node_modules\\.bin\\electron-vite.cmd')
    expect(config.options).toEqual(
      expect.objectContaining({
        detached: false,
        shell: true,
        stdio: ['ignore', 'inherit', 'inherit'],
      }),
    )
  })

  it('keeps the wrapper alive on SIGINT until the dev child closes', async () => {
    const child = new TestChildProcess()
    const processLike = new EventEmitter()
    const processKill = vi.fn()
    const spawnImpl = vi.fn(() => child)

    const runPromise = runElectronViteDev({
      args: [],
      cwd: '/repo',
      env: {},
      platform: 'darwin',
      processLike,
      processKill,
      shutdownTimeoutMs: 10_000,
      spawnImpl,
    })

    expect(spawnImpl).toHaveBeenCalledWith(
      '/repo/node_modules/.bin/electron-vite',
      ['dev'],
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', 'inherit', 'inherit'],
      }),
    )

    processLike.emit('SIGINT')
    expect(processKill).toHaveBeenCalledWith(-4242, 'SIGINT')

    let resolved = false
    void runPromise.then(() => {
      resolved = true
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(resolved).toBe(false)

    child.emit('close', 0, null)
    await expect(runPromise).resolves.toBe(0)
  })

  it('escalates a repeated shutdown signal to SIGKILL for the child process group', async () => {
    const child = new TestChildProcess()
    const processLike = new EventEmitter()
    const processKill = vi.fn()

    const runPromise = runElectronViteDev({
      cwd: '/repo',
      env: {},
      platform: 'darwin',
      processLike,
      processKill,
      shutdownTimeoutMs: 10_000,
      spawnImpl: vi.fn(() => child),
    })

    processLike.emit('SIGINT')
    processLike.emit('SIGINT')

    expect(processKill).toHaveBeenNthCalledWith(1, -4242, 'SIGINT')
    expect(processKill).toHaveBeenNthCalledWith(2, -4242, 'SIGKILL')

    child.emit('close', null, 'SIGKILL')
    await expect(runPromise).resolves.toBe(resolveSignalExitCode('SIGKILL'))
  })
})
