import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'

type PtyDataHandler = (event: { sessionId: string; data: string }) => void
type PtyExitHandler = (event: { sessionId: string; exitCode: number }) => void

describe('Pty runtime subscriptions', () => {
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

    let onDataHandler: PtyDataHandler | null = null
    let onExitHandler: PtyExitHandler | null = null

    class MockPtyHostSupervisor {
      public write = vi.fn()
      public resize = vi.fn()
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))

      public onData(handler: PtyDataHandler): void {
        onDataHandler = handler
      }

      public onExit(handler: PtyExitHandler): void {
        onExitHandler = handler
      }
    }

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp/opencove-test-userdata'),
      },
      utilityProcess: {
        fork: vi.fn(),
      },
      webContents: {
        getAllWebContents: () => [content],
        fromId: (id: number) => (id === 1 ? content : null),
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()
    expect(onDataHandler).not.toBeNull()
    expect(onExitHandler).not.toBeNull()

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    runtime.attach(1, sessionId)

    onDataHandler?.({ sessionId, data: 'hello' })
    await vi.advanceTimersByTimeAsync(40)

    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual([
      [IPC_CHANNELS.ptyData, { sessionId, data: 'hello', seq: 1 }],
    ])
    expect(await runtime.snapshot(sessionId)).toBe('hello')

    onExitHandler?.({ sessionId, exitCode: 0 })

    expect(send.mock.calls.some(([channel]) => channel === IPC_CHANNELS.ptyExit)).toBe(true)
    expect(await runtime.snapshot(sessionId)).toBe('hello')

    send.mockClear()

    onDataHandler?.({ sessionId, data: 'after-exit' })
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

    let onDataHandler: PtyDataHandler | null = null
    const kill = vi.fn()

    class MockPtyHostSupervisor {
      public write = vi.fn()
      public resize = vi.fn()
      public kill = kill
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))

      public onData(handler: PtyDataHandler): void {
        onDataHandler = handler
      }

      public onExit(_handler: PtyExitHandler): void {}
    }

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp/opencove-test-userdata'),
      },
      utilityProcess: {
        fork: vi.fn(),
      },
      webContents: {
        getAllWebContents: () => [content],
        fromId: (id: number) => (id === 1 ? content : null),
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()
    expect(onDataHandler).not.toBeNull()

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    runtime.attach(1, sessionId)

    onDataHandler?.({ sessionId, data: 'hello' })
    await vi.advanceTimersByTimeAsync(40)

    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData).length).toBe(1)

    runtime.kill(sessionId)
    expect(kill).toHaveBeenCalledWith(sessionId)

    send.mockClear()

    onDataHandler?.({ sessionId, data: 'after-kill' })
    await vi.advanceTimersByTimeAsync(40)

    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual([])

    runtime.dispose()
    vi.useRealTimers()
  })

  it('restores probe fallback after the last subscriber detaches', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const send = vi.fn()
    const write = vi.fn()
    const resize = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }

    let onDataHandler: PtyDataHandler | null = null

    class MockPtyHostSupervisor {
      public write = write
      public resize = resize
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))

      public onData(handler: PtyDataHandler): void {
        onDataHandler = handler
      }

      public onExit(_handler: PtyExitHandler): void {}
    }

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp/opencove-test-userdata'),
      },
      utilityProcess: {
        fork: vi.fn(),
      },
      webContents: {
        getAllWebContents: () => [content],
        fromId: (id: number) => (id === 1 ? content : null),
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()
    expect(onDataHandler).not.toBeNull()

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    runtime.attach(1, sessionId)
    runtime.resize(sessionId, 120, 40)

    onDataHandler?.({ sessionId, data: '\u001b[6n\u001b[c\u001b[?u' })
    expect(write.mock.calls).toEqual([
      [sessionId, '\u001b[1;1R'],
      [sessionId, '\u001b[?1;2c'],
      [sessionId, '\u001b[?0u'],
    ])
    expect(content.send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual(
      [],
    )

    write.mockClear()
    content.send.mockClear()

    runtime.detach(1, sessionId)

    onDataHandler?.({ sessionId, data: '\u001b[6n\u001b[c\u001b[?u' })
    expect(write.mock.calls).toEqual([
      [sessionId, '\u001b[1;1R'],
      [sessionId, '\u001b[?1;2c'],
      [sessionId, '\u001b[?0u'],
    ])

    runtime.dispose()
    vi.useRealTimers()
  })

  it('restores probe fallback when webContents cleanup removes the last subscriber', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const destroyedHandlers: Array<() => void> = []
    const write = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send: vi.fn(),
      once: (_event: string, handler: () => void) => {
        destroyedHandlers.push(handler)
      },
    }

    let onDataHandler: PtyDataHandler | null = null

    class MockPtyHostSupervisor {
      public write = write
      public resize = vi.fn()
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))

      public onData(handler: PtyDataHandler): void {
        onDataHandler = handler
      }

      public onExit(_handler: PtyExitHandler): void {}
    }

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp/opencove-test-userdata'),
      },
      utilityProcess: {
        fork: vi.fn(),
      },
      webContents: {
        getAllWebContents: () => [content],
        fromId: (id: number) => (id === 1 ? content : null),
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()
    expect(onDataHandler).not.toBeNull()

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    runtime.attach(1, sessionId)

    onDataHandler?.({ sessionId, data: '\u001b[>c' })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(sessionId, '\u001b[>0;115;0c')
    expect(content.send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual(
      [],
    )

    write.mockClear()
    content.send.mockClear()

    destroyedHandlers[0]?.()

    onDataHandler?.({ sessionId, data: '\u001b[>c' })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(sessionId, '\u001b[>0;115;0c')

    runtime.dispose()
    vi.useRealTimers()
  })

  it('coalesces snapshot writes and broadcasts per flush window', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const send = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }

    let onDataHandler: PtyDataHandler | null = null

    class MockPtyHostSupervisor {
      public write = vi.fn()
      public resize = vi.fn()
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))

      public onData(handler: PtyDataHandler): void {
        onDataHandler = handler
      }

      public onExit(_handler: PtyExitHandler): void {}
    }

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp/opencove-test-userdata'),
      },
      utilityProcess: {
        fork: vi.fn(),
      },
      webContents: {
        getAllWebContents: () => [content],
        fromId: (id: number) => (id === 1 ? content : null),
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()
    expect(onDataHandler).not.toBeNull()

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    runtime.attach(1, sessionId)

    onDataHandler?.({ sessionId, data: 'hel' })
    onDataHandler?.({ sessionId, data: 'lo' })
    await vi.advanceTimersByTimeAsync(40)

    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual([
      [IPC_CHANNELS.ptyData, { sessionId, data: 'hello', seq: 1 }],
    ])
    expect(await runtime.snapshot(sessionId)).toBe('hello')

    runtime.dispose()
    vi.useRealTimers()
  })

  it('flushes pending output before serving snapshots', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    let onDataHandler: PtyDataHandler | null = null

    class MockPtyHostSupervisor {
      public write = vi.fn()
      public resize = vi.fn()
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))

      public onData(handler: PtyDataHandler): void {
        onDataHandler = handler
      }

      public onExit(_handler: PtyExitHandler): void {}
    }

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp/opencove-test-userdata'),
      },
      utilityProcess: {
        fork: vi.fn(),
      },
      webContents: {
        getAllWebContents: () => [],
        fromId: () => null,
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()
    expect(onDataHandler).not.toBeNull()

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })

    onDataHandler?.({ sessionId, data: 'snap' })
    onDataHandler?.({ sessionId, data: 'shot' })

    expect(await runtime.snapshot(sessionId)).toBe('snapshot')

    await vi.advanceTimersByTimeAsync(40)
    expect(await runtime.snapshot(sessionId)).toBe('snapshot')

    runtime.dispose()
    vi.useRealTimers()
  })
})
