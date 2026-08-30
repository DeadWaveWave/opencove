import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'

describe('Pty runtime probe subscriptions', () => {
  it('restores probe fallback after the last subscriber detaches', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send: vi.fn(),
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
    await runtime.resize({
      sessionId,
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-probe',
    })

    processEngine.emitData({ sessionId, data: '\u001b[6n\u001b[c\u001b[?u' })
    expect(processEngine.write.mock.calls).toEqual([
      [sessionId, '\u001b[1;1R'],
      [sessionId, '\u001b[?1;2c'],
      [sessionId, '\u001b[?0u'],
    ])
    expect(content.send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual(
      [],
    )

    processEngine.write.mockClear()
    content.send.mockClear()
    runtime.detach(1, sessionId)

    processEngine.emitData({ sessionId, data: '\u001b[6n\u001b[c\u001b[?u' })
    expect(processEngine.write.mock.calls).toEqual([
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
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send: vi.fn(),
      once: (_event: string, handler: () => void) => {
        destroyedHandlers.push(handler)
      },
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

    processEngine.emitData({ sessionId, data: '\u001b[>c' })
    expect(processEngine.write).toHaveBeenCalledTimes(1)
    expect(processEngine.write).toHaveBeenCalledWith(sessionId, '\u001b[>0;115;0c')
    expect(content.send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyData)).toEqual(
      [],
    )

    processEngine.write.mockClear()
    content.send.mockClear()
    destroyedHandlers[0]?.()

    processEngine.emitData({ sessionId, data: '\u001b[>c' })
    expect(processEngine.write).toHaveBeenCalledTimes(1)
    expect(processEngine.write).toHaveBeenCalledWith(sessionId, '\u001b[>0;115;0c')

    runtime.dispose()
    vi.useRealTimers()
  })
})
