import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'

function mockElectronWebContents(content: {
  isDestroyed: () => boolean
  getType: () => string
  send: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
}): void {
  vi.doMock('electron', () => ({
    webContents: {
      getAllWebContents: () => [content],
      fromId: (id: number) => (id === 1 ? content : null),
    },
  }))
}

describe('Pty runtime subscriptions', () => {
  it('does not reactivate a session whose exit completed before spawn registration', async () => {
    vi.resetModules()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send: vi.fn(),
      once: vi.fn(),
    }
    mockElectronWebContents(content)

    let resolveSpawn!: (value: { sessionId: string }) => void
    const processEngine = new FakeTerminalProcessEngine()
    processEngine.spawn.mockImplementation(
      async () =>
        await new Promise<{ sessionId: string }>(resolve => {
          resolveSpawn = resolve
        }),
    )
    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
    const runtime = createPtyRuntime({ processEngine })
    const exits: Array<{ sessionId: string; exitCode: number }> = []
    runtime.onExit(event => exits.push(event))

    const spawning = runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    processEngine.emitData({ sessionId: 'session-before-registration', data: 'final output' })
    processEngine.emitExit({ sessionId: 'session-before-registration', exitCode: 0 })
    resolveSpawn({ sessionId: 'session-before-registration' })

    await expect(spawning).rejects.toThrow('completed before spawn registration')
    expect(exits).toEqual([{ sessionId: 'session-before-registration', exitCode: 0 }])
    await expect(runtime.snapshot('session-before-registration')).resolves.toBe('final output')
    runtime.dispose()
  })

  it('retires only the exact late session when runtime disposal wins spawn registration', async () => {
    vi.resetModules()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send: vi.fn(),
      once: vi.fn(),
    }
    mockElectronWebContents(content)

    let resolveSpawn!: (value: { sessionId: string }) => void
    const processEngine = new FakeTerminalProcessEngine()
    processEngine.spawn.mockImplementation(
      async () =>
        await new Promise<{ sessionId: string }>(resolve => {
          resolveSpawn = resolve
        }),
    )
    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
    const runtime = createPtyRuntime({ processEngine })

    const spawning = runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    runtime.dispose()
    resolveSpawn({ sessionId: 'session-after-runtime-disposal' })

    await expect(spawning).rejects.toThrow('lost its owner before spawn registration')
    expect(processEngine.kill).toHaveBeenCalledTimes(1)
    expect(processEngine.kill).toHaveBeenCalledWith('session-after-runtime-disposal')
  })

  it('cleans session subscriptions after exit and preserves the last snapshot', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const send = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }
    mockElectronWebContents(content)

    const processEngine = new FakeTerminalProcessEngine()
    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
    const runtime = createPtyRuntime({ processEngine })

    const foregroundEvent = {
      sessionId: 'session-1',
      observedAtMs: 200,
      source: 'process_scan' as const,
      exitCode: null,
      availability: 'available' as const,
      agent: null,
      shellOnly: true,
    }
    processEngine.emitForeground(foregroundEvent)
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.ptyForeground, foregroundEvent)
    send.mockClear()

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    runtime.attach(1, sessionId)

    processEngine.emitData({ sessionId, data: 'hello' })
    await vi.advanceTimersByTimeAsync(40)

    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual([
      [IPC_CHANNELS.ptyData, { sessionId, data: 'hello', seq: 1 }],
    ])
    expect(await runtime.snapshot(sessionId)).toBe('hello')

    processEngine.emitExit({ sessionId, exitCode: 0 })

    expect(send.mock.calls.some(([channel]) => channel === IPC_CHANNELS.ptyExit)).toBe(true)
    expect(await runtime.snapshot(sessionId)).toBe('hello')

    send.mockClear()
    processEngine.emitData({ sessionId, data: 'after-exit' })
    await vi.advanceTimersByTimeAsync(40)

    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual([])

    runtime.dispose()
    vi.useRealTimers()
  })

  it('cleans session subscriptions when killed', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const send = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }
    mockElectronWebContents(content)

    const processEngine = new FakeTerminalProcessEngine()
    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
    const runtime = createPtyRuntime({ processEngine })

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    runtime.attach(1, sessionId)
    processEngine.emitData({ sessionId, data: 'hello' })
    await vi.advanceTimersByTimeAsync(40)

    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData).length).toBe(1)

    runtime.kill(sessionId)
    expect(processEngine.kill).toHaveBeenCalledWith(sessionId)

    send.mockClear()
    processEngine.emitData({ sessionId, data: 'after-kill' })
    await vi.advanceTimersByTimeAsync(40)

    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual([])

    runtime.dispose()
    vi.useRealTimers()
  })
})
