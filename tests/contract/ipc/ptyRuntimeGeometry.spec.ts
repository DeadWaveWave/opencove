import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'

type PtyDataHandler = (event: { sessionId: string; data: string }) => void
type PtyExitHandler = (event: { sessionId: string; exitCode: number }) => void

describe('Pty runtime geometry', () => {
  it('does not forward unchanged geometry to the PTY host', async () => {
    vi.resetModules()

    const send = vi.fn()
    const resize = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }

    class MockPtyHostSupervisor {
      public write = vi.fn()
      public resize = resize
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))

      public onData(_handler: PtyDataHandler): void {}

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
    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })

    runtime.resize(sessionId, 80, 24, 'frame_commit')

    expect(resize).not.toHaveBeenCalled()
    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyGeometry)).toEqual([])

    runtime.resize(sessionId, 100, 32, 'frame_commit')

    expect(resize).toHaveBeenCalledWith(sessionId, 100, 32)
    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyGeometry)).toEqual([
      [IPC_CHANNELS.ptyGeometry, { sessionId, cols: 100, rows: 32, reason: 'frame_commit' }],
    ])

    runtime.dispose()
  })
})
