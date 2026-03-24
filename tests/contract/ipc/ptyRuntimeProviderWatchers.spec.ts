import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'

describe('Pty runtime provider watchers', () => {
  it('discovers an OpenCode session and maps busy to standby through the provider API', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.setSystemTime(new Date('2026-03-15T08:00:00.000Z'))

    const send = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }

    class MockPtyManager {
      public appendSnapshotData(): void {}
      public snapshot(): string {
        return ''
      }
      public write(): void {}
      public resize(): void {}
      public kill(): void {}
      public delete(): void {}
      public disposeAll(): void {}
      public spawnSession(): {
        sessionId: string
        pty: { onData: () => void; onExit: () => void }
      } {
        return { sessionId: 'session-1', pty: { onData: () => undefined, onExit: () => undefined } }
      }
    }

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'ses_opencode_1',
              directory: '/tmp/workspace',
              time: { created: Date.now() },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ses_opencode_1: { type: 'busy' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))

    vi.stubGlobal('fetch', fetchMock)

    vi.doMock('electron', () => ({
      webContents: {
        getAllWebContents: () => [content],
        fromId: () => content,
      },
    }))

    vi.doMock('../../../src/platform/process/pty/PtyManager', () => ({
      PtyManager: MockPtyManager,
    }))

    vi.doMock('../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator', () => ({
      locateAgentResumeSessionId: vi.fn().mockResolvedValue(null),
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()

    runtime.startSessionStateWatcher({
      sessionId: 'session-1',
      provider: 'opencode',
      cwd: '/tmp/workspace',
      launchMode: 'new',
      resumeSessionId: null,
      startedAtMs: Date.now(),
      opencodeBaseUrl: 'http://127.0.0.1:43123',
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(0)

    expect(
      send.mock.calls.some(
        ([channel, payload]) =>
          channel === IPC_CHANNELS.ptySessionMetadata &&
          payload.sessionId === 'session-1' &&
          payload.resumeSessionId === 'ses_opencode_1',
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
    expect(
      send.mock.calls.some(
        ([channel, payload]) =>
          channel === IPC_CHANNELS.ptyState &&
          payload.sessionId === 'session-1' &&
          payload.state === 'standby',
      ),
    ).toBe(true)

    runtime.dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts a gemini session watcher without treating raw typing as active work', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.setSystemTime(new Date('2026-03-15T08:00:00.000Z'))

    const send = vi.fn()
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }

    const captureGeminiSessionDiscoveryCursor = vi.fn().mockResolvedValue({
      entriesByFilePath: {},
    })
    const locateGeminiResumeSessionId = vi
      .fn()
      .mockResolvedValue('d7d89910-fa86-4253-a183-07db548da987')
    const resolveSessionFilePath = vi.fn().mockResolvedValue('/tmp/gemini-session.json')
    const geminiWatcherStart = vi.fn()

    class MockGeminiSessionStateWatcher {
      private readonly onState: (sessionId: string, state: 'working' | 'standby') => void

      public constructor(options: {
        onState: (sessionId: string, state: 'working' | 'standby') => void
      }) {
        this.onState = options.onState
      }

      public start(): void {
        geminiWatcherStart()
        setTimeout(() => {
          this.onState('session-1', 'working')
        }, 100)
        setTimeout(() => {
          this.onState('session-1', 'standby')
        }, 200)
      }

      public dispose(): void {}
    }

    class MockPtyManager {
      public appendSnapshotData(): void {}
      public snapshot(): string {
        return ''
      }
      public write(): void {}
      public resize(): void {}
      public kill(): void {}
      public delete(): void {}
      public disposeAll(): void {}
      public spawnSession(): {
        sessionId: string
        pty: { onData: () => void; onExit: () => void }
      } {
        return { sessionId: 'session-1', pty: { onData: () => undefined, onExit: () => undefined } }
      }
    }

    vi.doMock('electron', () => ({
      webContents: {
        getAllWebContents: () => [content],
        fromId: () => content,
      },
    }))

    vi.doMock('../../../src/platform/process/pty/PtyManager', () => ({
      PtyManager: MockPtyManager,
    }))

    vi.doMock(
      '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocatorProviders',
      () => ({
        captureGeminiSessionDiscoveryCursor,
        locateGeminiResumeSessionId,
      }),
    )

    vi.doMock('../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator', () => ({
      locateAgentResumeSessionId: vi.fn(),
    }))

    vi.doMock('../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver', () => ({
      resolveSessionFilePath,
    }))

    vi.doMock(
      '../../../src/contexts/agent/infrastructure/watchers/GeminiSessionStateWatcher',
      () => ({
        GeminiSessionStateWatcher: MockGeminiSessionStateWatcher,
      }),
    )

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()

    runtime.startSessionStateWatcher({
      sessionId: 'session-1',
      provider: 'gemini',
      cwd: '/tmp/workspace',
      launchMode: 'new',
      resumeSessionId: null,
      startedAtMs: Date.now(),
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    runtime.write('session-1', 'hello')
    await vi.advanceTimersByTimeAsync(50)

    expect(send.mock.calls.some(([channel]) => channel === IPC_CHANNELS.ptyState)).toBe(false)

    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(0)

    expect(captureGeminiSessionDiscoveryCursor).toHaveBeenCalledTimes(1)
    expect(locateGeminiResumeSessionId).toHaveBeenCalledTimes(1)
    expect(resolveSessionFilePath).toHaveBeenCalledTimes(1)
    expect(geminiWatcherStart).toHaveBeenCalledTimes(1)
    expect(
      send.mock.calls.some(
        ([channel, payload]) =>
          channel === IPC_CHANNELS.ptySessionMetadata &&
          payload.sessionId === 'session-1' &&
          payload.resumeSessionId === 'd7d89910-fa86-4253-a183-07db548da987',
      ),
    ).toBe(true)
    expect(
      send.mock.calls.filter(
        ([channel, payload]) =>
          channel === IPC_CHANNELS.ptyState &&
          payload.sessionId === 'session-1' &&
          payload.state === 'working',
      ),
    ).toHaveLength(1)
    expect(
      send.mock.calls.some(
        ([channel, payload]) =>
          channel === IPC_CHANNELS.ptyState &&
          payload.sessionId === 'session-1' &&
          payload.state === 'standby',
      ),
    ).toBe(true)

    runtime.dispose()
    vi.useRealTimers()
  })
})
