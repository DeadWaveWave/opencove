import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'

describe('Pty runtime snapshot subscriptions', () => {
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
    vi.doMock('electron', () => ({
      webContents: {
        getAllWebContents: () => [content],
        fromId: (id: number) => (id === 1 ? content : null),
      },
    }))

    const processEngine = new FakeTerminalProcessEngine()
    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
    const runtime = createPtyRuntime({ processEngine })

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    runtime.attach(1, sessionId)

    processEngine.emitData({ sessionId, data: 'hel' })
    processEngine.emitData({ sessionId, data: 'lo' })
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

    vi.doMock('electron', () => ({
      webContents: {
        getAllWebContents: () => [],
        fromId: () => null,
      },
    }))

    const processEngine = new FakeTerminalProcessEngine()
    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
    const runtime = createPtyRuntime({ processEngine })

    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    processEngine.emitData({ sessionId, data: 'snap' })
    processEngine.emitData({ sessionId, data: 'shot' })

    expect(await runtime.snapshot(sessionId)).toBe('snapshot')

    await vi.advanceTimersByTimeAsync(40)
    expect(await runtime.snapshot(sessionId)).toBe('snapshot')

    runtime.dispose()
    vi.useRealTimers()
  })
})
