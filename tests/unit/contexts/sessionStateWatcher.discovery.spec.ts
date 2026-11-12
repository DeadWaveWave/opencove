import { afterEach, expect, it, vi } from 'vitest'
import type { AgentSessionDiscoveryHandle } from '../../../src/contexts/agent/application/ports/AgentSessionDiscovery'
import { createSessionStateWatcherController } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import { createSessionFileStateWatcher } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherProvider'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

vi.mock('../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherProvider', () => ({
  createSessionFileStateWatcher: vi.fn(() => ({ start: vi.fn(), dispose: vi.fn() })),
}))
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver', () => ({
  resolveSessionFilePath: vi.fn(),
}))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('uses runtime-owned discovery and fences old file callbacks after an invocation is replaced', async () => {
  vi.useFakeTimers()
  let current = true
  const handle: AgentSessionDiscoveryHandle = {
    isCurrent: () => current,
    resolve: async () => ({ resumeSessionId: 'owned-id', filePath: 'owned.jsonl' }),
  }
  const capture = vi.fn(() => handle)
  const onState = vi.fn()
  const onMetadata = vi.fn()
  const reportIssue = vi.fn()
  const controller = createSessionStateWatcherController({
    sendToAllWindows: vi.fn(),
    onState,
    onMetadata,
    reportIssue,
    sessionDiscovery: { capture },
  })
  try {
    controller.start({
      sessionId: 'pty',
      provider: 'codex',
      cwd: process.cwd(),
      startedAtMs: Date.now(),
      launchMode: 'new',
      resumeSessionId: 'untrusted-renderer-id',
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(capture).toHaveBeenCalledWith('pty')
    expect(resolveSessionFilePath).not.toHaveBeenCalled()
    expect(onMetadata).toHaveBeenCalledWith({ sessionId: 'pty', resumeSessionId: 'owned-id' })
    const watcher = vi.mocked(createSessionFileStateWatcher).mock.calls[0][0]
    expect(watcher.filePath).toBe('owned.jsonl')
    watcher.onState('pty', 'working', { hookEventName: 'task_started' })
    expect(onState).toHaveBeenCalledTimes(1)
    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: 'pty',
        agentProvider: 'codex',
        source: 'session_file',
        state: 'working',
        hookEventName: 'task_started',
      }),
    )

    current = false
    watcher.onState('pty', 'standby')
    watcher.onUnavailable?.('pty')
    watcher.onError?.(new Error('old watcher'))
    controller.noteInteraction('pty', '\r')
    expect(onState).toHaveBeenCalledTimes(1)
    expect(reportIssue).not.toHaveBeenCalled()
  } finally {
    controller.dispose()
  }
})

it('discards a discovery result received after controller teardown', async () => {
  vi.useFakeTimers()
  let finish!: (result: { resumeSessionId: string; filePath: string }) => void
  const onMetadata = vi.fn()
  const controller = createSessionStateWatcherController({
    sendToAllWindows: vi.fn(),
    reportIssue: vi.fn(),
    onMetadata,
    sessionDiscovery: {
      capture: () => ({
        isCurrent: () => true,
        resolve: () =>
          new Promise(resolve => {
            finish = resolve
          }),
      }),
    },
  })
  controller.start({
    sessionId: 'pty',
    provider: 'codex',
    cwd: process.cwd(),
    startedAtMs: Date.now(),
    launchMode: 'new',
    resumeSessionId: null,
  })
  await vi.advanceTimersByTimeAsync(0)
  controller.dispose()
  finish({ resumeSessionId: 'late-id', filePath: 'late.jsonl' })
  await vi.advanceTimersByTimeAsync(0)
  expect(onMetadata).not.toHaveBeenCalled()
  expect(createSessionFileStateWatcher).not.toHaveBeenCalled()
})

it('routes private Claude records independently of state and fences disposed watcher generations', async () => {
  vi.useFakeTimers()
  const onState = vi.fn(),
    onClaudeTranscript = vi.fn()
  const controller = createSessionStateWatcherController({
    sendToAllWindows: vi.fn(),
    reportIssue: vi.fn(),
    onState,
    onClaudeTranscript,
    sessionDiscovery: {
      capture: () => ({
        isCurrent: () => true,
        resolve: async () => ({ resumeSessionId: 'provider', filePath: 'owned.jsonl' }),
      }),
    },
  })
  const input = {
    sessionId: 'pty',
    provider: 'claude-code' as const,
    cwd: process.cwd(),
    startedAtMs: Date.now(),
    launchMode: 'new' as const,
    resumeSessionId: null,
  }
  controller.start(input)
  await vi.advanceTimersByTimeAsync(0)
  const first = vi.mocked(createSessionFileStateWatcher).mock.calls[0][0]
  const record = {
    fileIdentity: 'file',
    position: 1,
    baseline: false,
    record: { kind: 'queue' as const, operation: 'enqueue' as const },
  }
  first.onClaudeTranscript?.(record)
  expect(onState).not.toHaveBeenCalled()
  expect(onClaudeTranscript).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ...record,
      sessionId: 'pty',
      providerSessionId: 'provider',
      generation: expect.any(Number),
    }),
  )
  const records = () =>
    onClaudeTranscript.mock.calls
      .map(([value]) => value)
      .filter(value => !value.captureConversation)
  const oldGeneration = records()[0].generation
  controller.start(input)
  await vi.advanceTimersByTimeAsync(0)
  first.onClaudeTranscript?.(record)
  expect(records()).toHaveLength(1)
  const second = vi.mocked(createSessionFileStateWatcher).mock.calls[1][0]
  second.onClaudeTranscript?.(record)
  expect(records()[1].generation).toBeGreaterThan(oldGeneration)
  controller.dispose()
  second.onClaudeTranscript?.(record)
  expect(records()).toHaveLength(2)
  expect(onClaudeTranscript.mock.calls.filter(([value]) => value.captureConversation)).toHaveLength(
    2,
  )
})
