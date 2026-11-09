import { expect, it, vi } from 'vitest'
import { createSessionStateWatcherController } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import { createSessionFileStateWatcher } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherProvider'

vi.mock(
  '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherProvider',
  async original => ({
    ...(await original<object>()),
    createSessionFileStateWatcher: vi.fn(() => ({ start: vi.fn(), dispose: vi.fn() })),
  }),
)

it('only treats the first attachment of a new invocation as live across retries and reconnects', async () => {
  vi.useFakeTimers()
  const input = {
    sessionId: 'pty',
    provider: 'codex' as const,
    cwd: '/workspace',
    launchMode: 'new' as const,
    resumeSessionId: 'provider',
    startedAtMs: Date.now(),
  }
  const controller = createSessionStateWatcherController({
    sendToAllWindows: vi.fn(),
    reportIssue: vi.fn(),
    sessionDiscovery: {
      capture: () => ({
        isCurrent: () => true,
        resolve: async () => ({ resumeSessionId: 'provider', filePath: 'session.jsonl' }),
      }),
    },
  })
  const readModes = () =>
    vi.mocked(createSessionFileStateWatcher).mock.calls.map(([options]) => options.initialRead)
  try {
    controller.start(input)
    await vi.advanceTimersByTimeAsync(0)
    expect(readModes()).toEqual(['live'])
    vi.mocked(createSessionFileStateWatcher).mock.calls[0][0].onError(new Error('read failed'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(readModes()).toEqual(['live', 'baseline'])
    controller.disposeSession('pty')
    controller.start(input)
    await vi.advanceTimersByTimeAsync(0)
    expect(readModes()).toEqual(['live', 'baseline', 'baseline'])
    controller.disposeSession('pty', true)
    controller.start(input)
    await vi.advanceTimersByTimeAsync(0)
    expect(readModes()).toEqual(['live', 'baseline', 'baseline', 'live'])
  } finally {
    controller.dispose()
    vi.clearAllMocks()
    vi.useRealTimers()
  }
})
