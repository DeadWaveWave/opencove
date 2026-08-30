import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
})

describe('terminal process-engine composition factories', () => {
  it('creates the desktop adapter with an Electron utility-process boundary', async () => {
    let adapterOptions: {
      createProcess: (modulePath: string) => unknown
      logFilePath: string
    } | null = null
    const child = { pid: 123 }
    const wrappedChild = { kind: 'electron-process' }
    const fork = vi.fn(() => child)
    const createElectronUtilityPtyHostProcess = vi.fn(() => wrappedChild)

    vi.doMock('electron', () => ({
      app: { getPath: () => '/tmp/opencove-user-data' },
      utilityProcess: { fork },
    }))
    vi.doMock('../../../src/contexts/terminal/infrastructure/PtyHostTerminalProcessEngine', () => ({
      PtyHostTerminalProcessEngine: function MockTerminalProcessEngine(
        options: typeof adapterOptions,
      ) {
        adapterOptions = options
      },
    }))
    vi.doMock('../../../src/platform/process/ptyHost/electronUtilityProcessAdapter', () => ({
      createElectronUtilityPtyHostProcess,
    }))

    const { createMainTerminalProcessEngine } =
      await import('../../../src/app/main/terminal/mainTerminalProcessEngineFactory')
    createMainTerminalProcessEngine()

    expect(adapterOptions?.logFilePath).toBe('/tmp/opencove-user-data/logs/pty-host.log')
    expect(adapterOptions?.createProcess('/tmp/pty-host.js')).toBe(wrappedChild)
    expect(fork).toHaveBeenCalledWith('/tmp/pty-host.js', [], {
      stdio: 'pipe',
      serviceName: 'OpenCove PTY Host',
    })
    expect(createElectronUtilityPtyHostProcess).toHaveBeenCalledWith(child)
  })

  it('creates the worker adapter with a Node child-process boundary', async () => {
    let adapterOptions: {
      createProcess: (modulePath: string) => unknown
      logFilePath: string
    } | null = null
    const child = { pid: 456 }
    const wrappedChild = { kind: 'node-process' }
    const fork = vi.fn(() => child)
    const createNodeChildPtyHostProcess = vi.fn(() => wrappedChild)

    vi.doMock('node:child_process', () => ({
      default: { fork },
      fork,
    }))
    vi.doMock('../../../src/contexts/terminal/infrastructure/PtyHostTerminalProcessEngine', () => ({
      PtyHostTerminalProcessEngine: function MockTerminalProcessEngine(
        options: typeof adapterOptions,
      ) {
        adapterOptions = options
      },
    }))
    vi.doMock('../../../src/platform/process/ptyHost/nodeProcessAdapter', () => ({
      createNodeChildPtyHostProcess,
    }))

    const { createWorkerTerminalProcessEngine } =
      await import('../../../src/app/main/controlSurface/terminal/workerTerminalProcessEngineFactory')
    createWorkerTerminalProcessEngine({ userDataPath: '/tmp/opencove-worker-data' })

    expect(adapterOptions?.logFilePath).toBe('/tmp/opencove-worker-data/logs/pty-host.log')
    expect(adapterOptions?.createProcess('/tmp/pty-host.js')).toBe(wrappedChild)
    expect(fork).toHaveBeenCalledWith('/tmp/pty-host.js', [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env },
    })
    expect(createNodeChildPtyHostProcess).toHaveBeenCalledWith(child)
  })
})
