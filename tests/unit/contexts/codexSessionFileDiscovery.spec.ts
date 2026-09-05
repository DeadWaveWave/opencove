import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexSessionFileDiscovery } from '../../../src/contexts/agent/infrastructure/cli/CodexSessionFileDiscovery'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import type { CodexSessionFile } from '../../../src/contexts/agent/infrastructure/cli/CodexSessionFiles'

const file = (sessionId: string, createdAt = 1_100): CodexSessionFile => ({
  sessionId,
  cwd: process.cwd(),
  filePath: `${sessionId}.jsonl`,
  payloadTimestampMs: createdAt,
  recordTimestampMs: createdAt,
})

afterEach(() => vi.useRealTimers())

describe('Codex session file discovery ownership', () => {
  it('binds a live terminal invocation through the registry without a hook', async () => {
    vi.useFakeTimers()
    const registry = new TerminalAgentInvocationRegistry()
    const terminal = registry.reserve({ sourceId: 'terminal-shim' })
    terminal.bind('pty')
    const invocation = terminal.beginInvocation({ invocationId: 'first', provider: 'codex' })!
    const discovery = new CodexSessionFileDiscovery({
      now: () => 1_000,
      readFiles: async () => [file('exact')],
    })
    const reservation = discovery.reserve({ cwd: process.cwd() })
    reservation.start('pty', { ...invocation, provider: 'codex', invocationId: 'first' })
    expect(registry.list().entries[0].terminalAgentActivity?.identityAuthority).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    expect(registry.list().entries[0]).toMatchObject({
      resumeSessionId: 'exact',
      terminalAgentActivity: { identityAuthority: 'session_file', generation: 1 },
    })
    terminal.complete({ invocationId: 'first', generation: 1 })
    expect(registry.list().entries[0]).toMatchObject({
      resumeSessionId: 'exact',
      terminalAgentActivity: { phase: 'exited' },
    })
    await reservation.dispose()
  })

  it('rejects a late read after replacement and cannot overwrite a new invocation', async () => {
    let finish!: (files: CodexSessionFile[]) => void
    const readFiles = vi.fn(
      () =>
        new Promise<CodexSessionFile[]>(resolve => {
          finish = resolve
        }),
    )
    const discovery = new CodexSessionFileDiscovery({ now: () => 1_000, readFiles })
    const first = discovery.reserve({ cwd: process.cwd() })
    first.start('pty')
    const oldHandle = discovery.capture('pty')!
    const pending = oldHandle.resolve()
    await first.dispose()
    const second = discovery.reserve({ cwd: process.cwd(), resumeSessionId: 'new' })
    second.start('pty')
    finish([file('old')])
    expect(await pending).toBeNull()
    expect(oldHandle.isCurrent()).toBe(false)
    expect(discovery.capture('pty')!.isCurrent()).toBe(true)
    await second.dispose()
  })

  it('keeps overlapping unbound same-directory launches ambiguous even after one exits', async () => {
    const readFiles = vi.fn(async () => [file('late')])
    const discovery = new CodexSessionFileDiscovery({ now: () => 1_000, readFiles })
    const first = discovery.reserve({ cwd: process.cwd() })
    first.start('one')
    const second = discovery.reserve({ cwd: process.cwd() })
    second.start('two')
    expect(await discovery.capture('one')!.resolve()).toBeNull()
    await second.dispose()
    expect(await discovery.capture('one')!.resolve()).toBeNull()
    expect(readFiles).not.toHaveBeenCalled()
    await first.dispose()
  })

  it('rejects multiple plausible files and old metadata replayed with a new timestamp', async () => {
    const readFiles = vi.fn(async () => [file('one'), file('two')])
    const discovery = new CodexSessionFileDiscovery({ now: () => 1_000, readFiles })
    const reservation = discovery.reserve({ cwd: process.cwd() })
    reservation.start('pty')
    expect(await discovery.capture('pty')!.resolve()).toBeNull()
    readFiles.mockResolvedValue([{ ...file('old', 100), recordTimestampMs: 1_200 }])
    expect(await discovery.capture('pty')!.resolve()).toBeNull()
    readFiles.mockResolvedValue([{ ...file('child'), source: { subagent: { thread_spawn: {} } } }])
    expect(await discovery.capture('pty')!.resolve()).toBeNull()
    await reservation.dispose()
  })

  it('keeps exact resume identities independent when launches overlap and shares pending reads', async () => {
    const readFiles = vi.fn(async () => [file('first', 100), file('second', 100)])
    const discovery = new CodexSessionFileDiscovery({ now: () => 1_000, readFiles })
    const first = discovery.reserve({ cwd: process.cwd(), resumeSessionId: 'first' })
    const second = discovery.reserve({ cwd: process.cwd(), resumeSessionId: 'second' })
    first.start('one')
    second.start('two')
    const handle = discovery.capture('one')!
    expect(await Promise.all([handle.resolve(), handle.resolve()])).toEqual([
      { resumeSessionId: 'first', filePath: 'first.jsonl' },
      { resumeSessionId: 'first', filePath: 'first.jsonl' },
    ])
    expect(readFiles).toHaveBeenCalledTimes(1)
    expect(await discovery.capture('two')!.resolve()).toMatchObject({ resumeSessionId: 'second' })
    await first.dispose()
    await second.dispose()
  })
})
