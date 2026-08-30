import { PtyHostSupervisor } from '@platform/process/ptyHost/supervisor'
import { PtyHostSpawnIdentityRegistry } from '@platform/process/ptyHost/spawnIdentityRegistry'
import { findLastSentMessage, TestPtyHostProcess } from './ptyHostSupervisor.testSupport'

describe('PtyHostSupervisor spawn identity', () => {
  it('returns the existing live session for a duplicate launch identity', () => {
    const registry = new PtyHostSpawnIdentityRegistry()

    expect(registry.findLiveSession('launch-1', () => true)).toBeNull()
    registry.bind('launch-1', 'session-1')
    expect(registry.findLiveSession('launch-1', sessionId => sessionId === 'session-1')).toBe(
      'session-1',
    )

    registry.release('launch-1', 'session-1')
    expect(registry.findLiveSession('launch-1', () => true)).toBeNull()
  })

  it('reuses one launch identity when retrying after a confirmed host exit', async () => {
    const firstProcess = new TestPtyHostProcess()
    const secondProcess = new TestPtyHostProcess()
    const processes = [firstProcess, secondProcess]
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => processes.shift() ?? secondProcess,
      reportIssue: () => undefined,
    })

    const spawnPromise = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    firstProcess.emitReady()
    await vi.waitFor(() => {
      expect(findLastSentMessage(firstProcess, 'spawn')).not.toBeNull()
    })
    const firstSpawn = findLastSentMessage<{ type: 'spawn'; launchId: string }>(
      firstProcess,
      'spawn',
    )

    firstProcess.emit('exit', 1)
    await vi.waitFor(() => {
      expect(processes).toHaveLength(0)
    })
    secondProcess.emitReady()
    await vi.waitFor(() => {
      expect(findLastSentMessage(secondProcess, 'spawn')).not.toBeNull()
    })
    const secondSpawn = findLastSentMessage<{
      type: 'spawn'
      requestId: string
      launchId: string
    }>(secondProcess, 'spawn')

    expect(secondSpawn?.launchId).toBe(firstSpawn?.launchId)
    secondProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: secondSpawn?.requestId,
      ok: true,
      result: { sessionId: 'session-after-confirmed-exit' },
    })
    await expect(spawnPromise).resolves.toEqual({ sessionId: 'session-after-confirmed-exit' })

    supervisor.dispose()
  })

  it('fails closed until a bounded escalation retires an unconfirmed host', async () => {
    const firstProcess = new TestPtyHostProcess()
    firstProcess.exitOnKill = false
    firstProcess.failPostMessageTypes.add('spawn')
    const secondProcess = new TestPtyHostProcess()
    const processes = [firstProcess, secondProcess]
    const createProcess = vi.fn(() => processes.shift() ?? secondProcess)
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess,
      reportIssue: () => undefined,
      ambiguousExitTimeoutMs: 5,
    })

    const spawnPromise = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    firstProcess.emitReady()

    await expect(spawnPromise).rejects.toThrow('Channel closed')
    expect(createProcess).toHaveBeenCalledTimes(1)
    await expect(
      supervisor.spawn({
        command: '/bin/zsh',
        args: [],
        cwd: '/',
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow('prior host exit is unconfirmed')
    expect(createProcess).toHaveBeenCalledTimes(1)

    await vi.waitFor(() => {
      expect(firstProcess.killSignals).toContain('SIGKILL')
    })

    const recoveredSpawn = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    await vi.waitFor(() => expect(createProcess).toHaveBeenCalledTimes(2))
    secondProcess.emitReady()
    await vi.waitFor(() => expect(findLastSentMessage(secondProcess, 'spawn')).not.toBeNull())
    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      secondProcess,
      'spawn',
    )
    secondProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: sentSpawn?.requestId,
      ok: true,
      result: { sessionId: 'session-after-deadline' },
    })
    await expect(recoveredSpawn).resolves.toEqual({ sessionId: 'session-after-deadline' })

    supervisor.dispose()
  })

  it('allows a subsequent spawn when an ambiguous host later emits exit', async () => {
    const firstProcess = new TestPtyHostProcess()
    firstProcess.exitOnKill = false
    firstProcess.failPostMessageTypes.add('spawn')
    const secondProcess = new TestPtyHostProcess()
    const processes = [firstProcess, secondProcess]
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => processes.shift() ?? secondProcess,
      reportIssue: () => undefined,
      ambiguousExitTimeoutMs: 1_000,
    })

    const failedSpawn = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    firstProcess.emitReady()
    await expect(failedSpawn).rejects.toThrow('Channel closed')

    firstProcess.emit('exit', 1)
    const recoveredSpawn = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    await vi.waitFor(() => expect(processes).toHaveLength(0), { timeout: 1_000 })
    secondProcess.emitReady()
    await vi.waitFor(() => expect(findLastSentMessage(secondProcess, 'spawn')).not.toBeNull())
    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      secondProcess,
      'spawn',
    )
    secondProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: sentSpawn?.requestId,
      ok: true,
      result: { sessionId: 'session-after-observed-exit' },
    })
    await expect(recoveredSpawn).resolves.toEqual({ sessionId: 'session-after-observed-exit' })

    supervisor.dispose()
  })

  it('does not retry a plain spawn response timeout', async () => {
    const testProcess = new TestPtyHostProcess()
    const createProcess = vi.fn(() => testProcess)
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess,
      reportIssue: () => undefined,
      spawnTimeoutMs: 5,
    })

    const spawnPromise = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    testProcess.emitReady()

    await expect(spawnPromise).rejects.toThrow('spawn timeout')
    expect(createProcess).toHaveBeenCalledTimes(1)
    expect(
      testProcess.sentMessages.filter(message => (message as { type?: string }).type === 'spawn'),
    ).toHaveLength(1)

    supervisor.dispose()
  })
})
