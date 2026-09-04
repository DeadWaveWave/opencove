import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalForegroundEvent } from '../../../src/shared/contracts/dto'
import type { TerminalProcessEnginePort } from '../../../src/contexts/terminal/application/ports/TerminalProcessEnginePort'

afterEach(() => {
  vi.doUnmock('../../../src/platform/process/ptyHost/supervisor')
  vi.resetModules()
})

describe('PtyHostTerminalProcessEngine', () => {
  it('implements the process-engine command contract without changing typed resize results', async () => {
    const spawn = vi.fn().mockResolvedValue({ sessionId: 'session-1' })
    const write = vi.fn()
    const probeForeground = vi.fn()
    const resize = vi
      .fn()
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        status: 'applied_verified',
        cols: 100,
        rows: 32,
      })
      .mockResolvedValueOnce({ sessionId: 'session-1', status: 'applied_unverified' })
    const kill = vi.fn()
    const crash = vi.fn()
    const dispose = vi.fn()
    const constructorOptions: unknown[] = []

    class MockPtyHostSupervisor {
      public constructor(options: unknown) {
        constructorOptions.push(options)
      }

      public spawn = spawn
      public write = write
      public probeForeground = probeForeground
      public resize = resize
      public kill = kill
      public crash = crash
      public dispose = dispose
      public onData = vi.fn(() => vi.fn())
      public onExit = vi.fn(() => vi.fn())
      public onForeground = vi.fn(() => vi.fn())
    }

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { PtyHostTerminalProcessEngine } =
      await import('../../../src/contexts/terminal/infrastructure/PtyHostTerminalProcessEngine')
    const options = {
      baseDir: '/runtime',
      createProcess: vi.fn(),
      logFilePath: '/logs/pty-host.log',
    }
    const engine: TerminalProcessEnginePort = new PtyHostTerminalProcessEngine(options)
    const spawnInput = {
      command: '/bin/zsh',
      args: ['-lc', 'echo ok'],
      cwd: '/workspace',
      env: { TEST_VALUE: '1' },
      cols: 80,
      rows: 24,
    }

    await expect(engine.spawn(spawnInput)).resolves.toEqual({ sessionId: 'session-1' })
    engine.write('session-1', 'plain')
    engine.write('session-1', '\u0000\u001b', 'binary')
    engine.probeForeground('session-1')
    await expect(engine.resize('session-1', 100, 32)).resolves.toEqual({
      sessionId: 'session-1',
      status: 'applied_verified',
      cols: 100,
      rows: 32,
    })
    await expect(engine.resize('session-1', 120, 40)).resolves.toEqual({
      sessionId: 'session-1',
      status: 'applied_unverified',
    })
    engine.kill('session-1')
    engine.crashForDebug?.()

    expect(constructorOptions).toEqual([options])
    expect(spawn).toHaveBeenCalledWith(spawnInput)
    expect(write).toHaveBeenNthCalledWith(1, 'session-1', 'plain')
    expect(write).toHaveBeenNthCalledWith(2, 'session-1', '\u0000\u001b', 'binary')
    expect(probeForeground).toHaveBeenCalledWith('session-1')
    expect(resize).toHaveBeenNthCalledWith(1, 'session-1', 100, 32)
    expect(resize).toHaveBeenNthCalledWith(2, 'session-1', 120, 40)
    expect(kill).toHaveBeenCalledWith('session-1')
    expect(crash).toHaveBeenCalledTimes(1)

    engine.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('forwards raw host events once and owns listener cleanup exactly once', async () => {
    let emitData: ((event: { sessionId: string; data: string }) => void) | null = null
    let emitExit: ((event: { sessionId: string; exitCode: number }) => void) | null = null
    let emitForeground: ((event: TerminalForegroundEvent) => void) | null = null
    const disposeData = vi.fn()
    const disposeExit = vi.fn()
    const disposeForeground = vi.fn()
    const disposeHost = vi.fn()
    const onData = vi.fn((listener: typeof emitData) => {
      emitData = listener
      return disposeData
    })
    const onExit = vi.fn((listener: typeof emitExit) => {
      emitExit = listener
      return disposeExit
    })
    const onForeground = vi.fn((listener: typeof emitForeground) => {
      emitForeground = listener
      return disposeForeground
    })

    class MockPtyHostSupervisor {
      public spawn = vi.fn()
      public write = vi.fn()
      public resize = vi.fn()
      public kill = vi.fn()
      public crash = vi.fn()
      public dispose = disposeHost
      public onData = onData
      public onExit = onExit
      public onForeground = onForeground
    }

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { PtyHostTerminalProcessEngine } =
      await import('../../../src/contexts/terminal/infrastructure/PtyHostTerminalProcessEngine')
    const engine: TerminalProcessEnginePort = new PtyHostTerminalProcessEngine({
      baseDir: '/runtime',
      createProcess: vi.fn(),
    })
    const dataListener = vi.fn()
    const removedDataListener = vi.fn()
    const exitListener = vi.fn()
    const foregroundListener = vi.fn()
    const unsubscribeRemovedData = engine.onData(removedDataListener)
    engine.onData(dataListener)
    engine.onExit(exitListener)
    engine.onForeground(foregroundListener)
    unsubscribeRemovedData()

    const rawData = { sessionId: 'session-1', data: '\u001b[6nraw\u0000' }
    const exit = { sessionId: 'session-1', exitCode: 9 }
    const foreground: TerminalForegroundEvent = {
      sessionId: 'session-1',
      observedAtMs: 123,
      source: 'process_scan',
      exitCode: null,
      availability: 'available',
      agent: null,
      shellOnly: true,
    }
    emitData?.(rawData)
    emitExit?.(exit)
    emitForeground?.(foreground)

    expect(onData).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onForeground).toHaveBeenCalledTimes(1)
    expect(dataListener).toHaveBeenCalledWith(rawData)
    expect(removedDataListener).not.toHaveBeenCalled()
    expect(exitListener).toHaveBeenCalledWith(exit)
    expect(foregroundListener).toHaveBeenCalledWith(foreground)

    engine.dispose()
    engine.dispose()
    emitData?.({ sessionId: 'session-1', data: 'after-dispose' })

    expect(disposeData).toHaveBeenCalledTimes(1)
    expect(disposeExit).toHaveBeenCalledTimes(1)
    expect(disposeForeground).toHaveBeenCalledTimes(1)
    expect(disposeHost).toHaveBeenCalledTimes(1)
    expect(dataListener).toHaveBeenCalledTimes(1)
  })
})
