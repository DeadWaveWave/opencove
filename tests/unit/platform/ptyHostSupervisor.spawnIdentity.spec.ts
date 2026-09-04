import { PtyHostSupervisor } from '@platform/process/ptyHost/supervisor'
import { PtyHostSpawnIdentityRegistry } from '@platform/process/ptyHost/spawnIdentityRegistry'
import {
  findLastSentMessage,
  TestPtyHostProcess,
  waitForSentMessage,
} from './ptyHostSupervisor.testSupport'

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

  it('publishes pre-response output before its buffered exit completion', async () => {
    const testProcess = new TestPtyHostProcess()
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
    })
    const events: Array<{ type: 'data' | 'exit'; value: string | number }> = []
    supervisor.onData(event => events.push({ type: 'data', value: event.data }))
    supervisor.onExit(event => events.push({ type: 'exit', value: event.exitCode }))

    const spawnPromise = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    testProcess.emitReady()
    await vi.waitFor(() => {
      expect(findLastSentMessage(testProcess, 'spawn')).not.toBeNull()
    })
    const request = findLastSentMessage<{ type: 'spawn'; requestId: string }>(testProcess, 'spawn')
    if (!request) {
      throw new Error('missing spawn request')
    }

    testProcess.emitHostMessage({
      type: 'data',
      sessionId: 'early-exit-session',
      data: 'thread already has an active writer (-32600)',
    })
    testProcess.emitHostMessage({
      type: 'exit',
      sessionId: 'early-exit-session',
      exitCode: 1,
    })
    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: request.requestId,
      ok: true,
      result: { sessionId: 'early-exit-session' },
    })

    await expect(spawnPromise).resolves.toEqual({ sessionId: 'early-exit-session' })
    expect(events).toEqual([
      { type: 'data', value: 'thread already has an active writer (-32600)' },
      { type: 'exit', value: 1 },
    ])

    supervisor.dispose()
  })

  it('retires a spawn result that is correlated to a different request type', async () => {
    const testProcess = new TestPtyHostProcess()
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
    })

    const spawnPromise = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    testProcess.emitReady()
    await vi.waitFor(() => {
      expect(findLastSentMessage(testProcess, 'spawn')).not.toBeNull()
    })
    const spawnRequest = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      testProcess,
      'spawn',
    )
    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: spawnRequest?.requestId,
      ok: true,
      result: { sessionId: 'owned-session' },
    })
    await expect(spawnPromise).resolves.toEqual({ sessionId: 'owned-session' })

    const resizePromise = supervisor.resize('owned-session', 100, 30)
    await vi.waitFor(() => {
      expect(findLastSentMessage(testProcess, 'resize')).not.toBeNull()
    })
    const resizeRequest = findLastSentMessage<{ type: 'resize'; requestId: string }>(
      testProcess,
      'resize',
    )
    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: resizeRequest?.requestId,
      ok: true,
      result: { sessionId: 'unowned-session' },
    })

    await expect(resizePromise).rejects.toThrow('does not match its pending request')
    expect(findLastSentMessage(testProcess, 'kill')).toMatchObject({
      sessionId: 'unowned-session',
    })

    supervisor.dispose()
  })

  it('retires the exact session disclosed by a malformed spawn success', async () => {
    const testProcess = new TestPtyHostProcess()
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
    })

    const spawning = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    testProcess.emitReady()
    await vi.waitFor(() => expect(findLastSentMessage(testProcess, 'spawn')).not.toBeNull())
    const request = findLastSentMessage<{ type: 'spawn'; requestId: string }>(testProcess, 'spawn')

    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: request?.requestId,
      ok: true,
      result: { sessionId: 'malformed-owned-session', unexpected: true },
    })

    await expect(spawning).rejects.toThrow('malformed response')
    expect(findLastSentMessage(testProcess, 'kill')).toMatchObject({
      sessionId: 'malformed-owned-session',
    })
    supervisor.dispose()
  })

  it('quarantines a host when malformed spawn success hides the created session identity', async () => {
    const testProcess = new TestPtyHostProcess()
    testProcess.exitOnKill = false
    const createProcess = vi.fn(() => testProcess)
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess,
      reportIssue: () => undefined,
    })

    const spawning = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    testProcess.emitReady()
    await vi.waitFor(() => expect(findLastSentMessage(testProcess, 'spawn')).not.toBeNull())
    const request = findLastSentMessage<{ type: 'spawn'; requestId: string }>(testProcess, 'spawn')

    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: request?.requestId,
      ok: true,
      result: {},
    })

    await expect(spawning).rejects.toThrow('malformed response')
    expect(testProcess.killCalls).toBe(1)
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
    supervisor.dispose()
  })

  it('keeps an escalated host fenced until that exact child confirms exit', async () => {
    vi.useFakeTimers()
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

    try {
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

      await vi.advanceTimersToNextTimerAsync()
      expect(firstProcess.killSignals).toContain('SIGKILL')
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

      firstProcess.emit('exit', 1)
      const recoveredSpawn = supervisor.spawn({
        command: '/bin/zsh',
        args: [],
        cwd: '/',
        cols: 80,
        rows: 24,
      })
      await vi.advanceTimersToNextTimerAsync()
      expect(createProcess).toHaveBeenCalledTimes(2)
      const sentSpawnPromise = waitForSentMessage<{ type: 'spawn'; requestId: string }>(
        secondProcess,
        'spawn',
      )
      secondProcess.emitReady()
      const sentSpawn = await sentSpawnPromise
      secondProcess.emitHostMessage({
        type: 'response',
        requestType: 'spawn',
        requestId: sentSpawn?.requestId,
        ok: true,
        result: { sessionId: 'session-after-confirmed-exit' },
      })
      await expect(recoveredSpawn).resolves.toEqual({
        sessionId: 'session-after-confirmed-exit',
      })
    } finally {
      supervisor.dispose()
      vi.useRealTimers()
    }
  })

  it('does not replace a host when both termination requests throw', async () => {
    vi.useFakeTimers()
    const firstProcess = new TestPtyHostProcess()
    firstProcess.exitOnKill = false
    firstProcess.killError = new Error('kill denied')
    firstProcess.failPostMessageTypes.add('spawn')
    const createProcess = vi.fn(() => firstProcess)
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess,
      reportIssue: () => undefined,
      ambiguousExitTimeoutMs: 5,
    })

    try {
      const failedSpawn = supervisor.spawn({
        command: '/bin/zsh',
        args: [],
        cwd: '/',
        cols: 80,
        rows: 24,
      })
      firstProcess.emitReady()
      await expect(failedSpawn).rejects.toThrow('Channel closed')
      await vi.advanceTimersToNextTimerAsync()
      expect(firstProcess.killSignals).toEqual([undefined, 'SIGKILL'])

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
    } finally {
      supervisor.dispose()
      vi.useRealTimers()
    }
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

  it('retires a late successful spawn after request ownership times out', async () => {
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
    const rejection = expect(spawnPromise).rejects.toThrow('spawn timeout')
    testProcess.emitReady()
    await vi.waitFor(() => {
      expect(findLastSentMessage(testProcess, 'spawn')).not.toBeNull()
    })
    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      testProcess,
      'spawn',
    )
    if (!sentSpawn) {
      throw new Error('missing spawn request')
    }

    await rejection
    expect(createProcess).toHaveBeenCalledTimes(1)
    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: sentSpawn.requestId,
      ok: true,
      result: { sessionId: 'late-unowned-session' },
    })

    await vi.waitFor(() => {
      expect(findLastSentMessage(testProcess, 'kill')).toMatchObject({
        sessionId: 'late-unowned-session',
      })
    })

    supervisor.dispose()
  })
})
