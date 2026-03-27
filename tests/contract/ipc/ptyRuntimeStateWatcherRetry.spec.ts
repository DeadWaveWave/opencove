import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'

describe('Pty runtime session state watcher', () => {
  it('retries session state watcher discovery after user input', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const send = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }

    const locateAgentResumeSessionId = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('resume-1')

    const resolveSessionFilePath = vi.fn().mockResolvedValue('/tmp/rollout.jsonl')

    class MockSessionTurnStateWatcher {
      private readonly onState: (sessionId: string, state: 'working' | 'standby') => void

      public constructor(options: {
        onState: (sessionId: string, state: 'working' | 'standby') => void
      }) {
        this.onState = options.onState
      }

      public start(): void {
        this.onState('session-1', 'working')
      }

      public dispose(): void {}
    }

    class MockPtyHostSupervisor {
      public write = vi.fn()
      public resize = vi.fn()
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))
      public onData(): void {}
      public onExit(): void {}
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
        fromId: () => content,
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    vi.doMock('../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator', () => ({
      locateAgentResumeSessionId,
    }))

    vi.doMock('../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver', () => ({
      resolveSessionFilePath,
    }))

    vi.doMock(
      '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher',
      () => ({
        SessionTurnStateWatcher: MockSessionTurnStateWatcher,
      }),
    )

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()

    runtime.startSessionStateWatcher({
      sessionId: 'session-1',
      provider: 'codex',
      cwd: '/tmp',
      launchMode: 'new',
      resumeSessionId: null,
      startedAtMs: Date.now(),
    })

    await vi.advanceTimersByTimeAsync(0)

    expect(locateAgentResumeSessionId).toHaveBeenCalledTimes(1)
    expect(send.mock.calls.some(([channel]) => channel === IPC_CHANNELS.ptySessionMetadata)).toBe(
      false,
    )

    runtime.write('session-1', 'hello')
    await vi.advanceTimersByTimeAsync(0)

    expect(locateAgentResumeSessionId).toHaveBeenCalledTimes(2)
    expect(resolveSessionFilePath).toHaveBeenCalledTimes(1)
    expect(
      send.mock.calls.some(
        ([channel, payload]) =>
          channel === IPC_CHANNELS.ptySessionMetadata &&
          payload.sessionId === 'session-1' &&
          payload.resumeSessionId === 'resume-1',
      ),
    ).toBe(true)
    expect(
      send.mock.calls.some(
        ([channel, payload]) =>
          channel === IPC_CHANNELS.ptyState &&
          payload.sessionId === 'session-1' &&
          payload.state === 'working',
      ),
    ).toBe(true)

    runtime.dispose()
    vi.useRealTimers()
  })
})
