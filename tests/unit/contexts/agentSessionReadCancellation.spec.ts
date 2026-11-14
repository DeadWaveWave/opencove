// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'
import { locateGeminiResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocatorProviders'
import { listCodexSessionFiles } from '../../../src/contexts/agent/infrastructure/cli/CodexSessionFiles'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'
import {
  readLastAssistantMessageFromSessionFile,
  readLastAssistantMessageFromOpenCodeSession,
} from '../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage'
import { openReadOnlySqliteDb } from '../../../src/contexts/agent/infrastructure/opencode/OpenCodeSqlite'

vi.mock('node:fs/promises', () => ({
  default: { readdir: vi.fn(), stat: vi.fn(), readFile: vi.fn(), open: vi.fn() },
}))
vi.mock('../../../src/contexts/agent/infrastructure/opencode/OpenCodeDbLocator', () => ({
  resolveOpenCodeDbPath: async () => '/db',
}))
vi.mock(
  '../../../src/contexts/agent/infrastructure/opencode/OpenCodeSqlite',
  async importOriginal => ({ ...(await importOriginal<object>()), openReadOnlySqliteDb: vi.fn() }),
)

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(fs.readdir).mockResolvedValue([])
  vi.mocked(fs.stat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  vi.mocked(fs.readFile).mockResolvedValue('{')
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    value => ({ value }),
    error => ({ error }),
  )
const input = { cwd: '/workspace', startedAtMs: 1_700_000_000_000, timeoutMs: 3_000 }

it.each(['codex', 'gemini', 'file', 'structured'] as const)(
  'aborts %s retry without waiting for its next poll or deadline',
  async kind => {
    const controller = new AbortController()
    const signal = controller.signal
    const operation =
      kind === 'codex'
        ? locateAgentResumeSessionId({ ...input, provider: 'codex', signal })
        : kind === 'gemini'
          ? locateGeminiResumeSessionId({ ...input, signal })
          : kind === 'file'
            ? resolveSessionFilePath({
                ...input,
                provider: 'claude-code',
                sessionId: 'missing',
                signal,
              })
            : readLastAssistantMessageFromSessionFile('gemini', '/session', signal)
    const result = settled(operation)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    const reason = new Error('client ended')
    controller.abort(reason)
    expect(await result).toEqual({ error: reason })
    expect(vi.getTimerCount()).toBe(0)
  },
)

it.each(['codex', 'gemini', 'pi'] as const)(
  'joins an in-flight %s read and rejects its late contents',
  async provider => {
    let release!: (content: string) => void
    vi.mocked(fs.readFile).mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve
        }),
    )
    const controller = new AbortController()
    const done = vi.fn()
    const result = settled(
      readLastAssistantMessageFromSessionFile(provider, '/session', controller.signal),
    ).then(done)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    release('{}')
    await result
    expect(done).toHaveBeenCalledWith({ error: controller.signal.reason })
  },
)

it('closes a Codex file handle acquired after cancellation without starting another read', async () => {
  vi.mocked(fs.readdir).mockResolvedValue([
    { name: 'rollout-session.jsonl', parentPath: '/sessions', isFile: () => true },
  ] as never)
  const read = vi.fn()
  const close = vi.fn(async () => {})
  let release!: () => void
  vi.mocked(fs.open).mockImplementation(
    () =>
      new Promise(resolve => {
        release = () => resolve({ read, close } as never)
      }),
  )
  const controller = new AbortController()
  const result = settled(
    listCodexSessionFiles({
      ...input,
      sessionId: 'session',
      codexHomeDirectories: ['/study'],
      signal: controller.signal,
    }),
  )
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  release()
  expect(await result).toEqual({ error: controller.signal.reason })
  expect(read).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})

it('closes a read-only database acquired after cancellation without running a query', async () => {
  const prepare = vi.fn()
  const close = vi.fn()
  let release!: () => void
  vi.mocked(openReadOnlySqliteDb).mockImplementation(
    () =>
      new Promise(resolve => {
        release = () => resolve({ prepare, close } as never)
      }),
  )
  const controller = new AbortController()
  const result = settled(
    readLastAssistantMessageFromOpenCodeSession('s', '/workspace', controller.signal),
  )
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  release()
  expect(await result).toEqual({ error: controller.signal.reason })
  expect(prepare).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})

it('cancels the SQLite busy retry and never opens another database after abort', async () => {
  vi.mocked(openReadOnlySqliteDb).mockRejectedValue(
    Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }),
  )
  const controller = new AbortController()
  const result = settled(
    readLastAssistantMessageFromOpenCodeSession('s', '/workspace', controller.signal),
  )
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(1)
  controller.abort()
  expect(await result).toEqual({ error: controller.signal.reason })
  expect(openReadOnlySqliteDb).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
