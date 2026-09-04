import { PtyHostSupervisor } from '@platform/process/ptyHost/supervisor'
import { findLastSentMessage, TestPtyHostProcess } from './ptyHostSupervisor.testSupport'

const spawnInput = {
  command: '/bin/zsh',
  args: ['-lc', 'echo OK'],
  cwd: '/',
  cols: 80,
  rows: 24,
}

async function completeSpawn(
  supervisor: PtyHostSupervisor,
  testProcess: TestPtyHostProcess,
  sessionId: string,
): Promise<void> {
  const spawnPromise = supervisor.spawn(spawnInput)
  testProcess.emitReady()
  await vi.waitFor(() => expect(findLastSentMessage(testProcess, 'spawn')).not.toBeNull())
  const request = findLastSentMessage<{ type: 'spawn'; requestId: string }>(testProcess, 'spawn')
  testProcess.emitHostMessage({
    type: 'response',
    requestType: 'spawn',
    requestId: request?.requestId,
    ok: true,
    result: { sessionId },
  })
  await expect(spawnPromise).resolves.toEqual({ sessionId })
}

describe('PtyHostSupervisor protocol fencing', () => {
  it('stamps the ready host identity on spawn, resize, write, kill and shutdown', async () => {
    const testProcess = new TestPtyHostProcess('host-instance-a')
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
    })

    await completeSpawn(supervisor, testProcess, 'session-a')
    supervisor.write('session-a', 'echo fenced')

    const resizePromise = supervisor.resize('session-a', 100, 30)
    await vi.waitFor(() => expect(findLastSentMessage(testProcess, 'resize')).not.toBeNull())
    const resizeRequest = findLastSentMessage<{ type: 'resize'; requestId: string }>(
      testProcess,
      'resize',
    )
    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'resize',
      requestId: resizeRequest?.requestId,
      ok: true,
      result: {
        sessionId: 'session-a',
        resize: { status: 'applied_verified', cols: 100, rows: 30 },
      },
    })
    await resizePromise
    supervisor.kill('session-a')
    supervisor.dispose()

    const boundMessages = testProcess.sentMessages.filter(message => {
      const type = (message as { type?: unknown }).type
      return (
        type === 'spawn' ||
        type === 'write' ||
        type === 'resize' ||
        type === 'kill' ||
        type === 'shutdown'
      )
    }) as Array<{ hostInstanceId?: unknown }>
    expect(boundMessages).toHaveLength(5)
    expect(boundMessages.every(message => message.hostInstanceId === 'host-instance-a')).toBe(true)
  })

  it('ignores late responses from a replaced host instance during restart', async () => {
    const firstProcess = new TestPtyHostProcess('host-instance-first')
    const secondProcess = new TestPtyHostProcess('host-instance-second')
    const processes = [firstProcess, secondProcess]
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => processes.shift() ?? secondProcess,
      reportIssue: () => undefined,
    })

    await completeSpawn(supervisor, firstProcess, 'session-first')
    firstProcess.emit('exit', 1)

    const secondSpawn = supervisor.spawn(spawnInput)
    await vi.waitFor(() => expect(processes).toHaveLength(0))
    secondProcess.emitReady()
    await vi.waitFor(() => expect(findLastSentMessage(secondProcess, 'spawn')).not.toBeNull())
    const request = findLastSentMessage<{
      type: 'spawn'
      requestId: string
      hostInstanceId: string
    }>(secondProcess, 'spawn')
    expect(request?.hostInstanceId).toBe('host-instance-second')

    let settled = false
    void secondSpawn.finally(() => {
      settled = true
    })
    secondProcess.emitHostMessage(
      {
        type: 'response',
        requestType: 'spawn',
        requestId: request?.requestId,
        ok: true,
        result: { sessionId: 'stale-session' },
      },
      firstProcess.hostInstanceId,
    )
    firstProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: request?.requestId,
      ok: true,
      result: { sessionId: 'late-session' },
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    secondProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: request?.requestId,
      ok: true,
      result: { sessionId: 'session-second' },
    })
    await expect(secondSpawn).resolves.toEqual({ sessionId: 'session-second' })
    supervisor.dispose()
  })

  it('fails a response whose operation or session identity does not match the request', async () => {
    const testProcess = new TestPtyHostProcess('host-instance-response')
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
    })
    await completeSpawn(supervisor, testProcess, 'session-response')

    const spoofedOperation = supervisor.resize('session-response', 100, 30)
    await vi.waitFor(() => expect(findLastSentMessage(testProcess, 'resize')).not.toBeNull())
    const firstResize = findLastSentMessage<{ type: 'resize'; requestId: string }>(
      testProcess,
      'resize',
    )
    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: firstResize?.requestId,
      ok: true,
      result: { sessionId: 'session-response' },
    })
    await expect(spoofedOperation).rejects.toThrow('does not match its pending request')

    const spoofedSession = supervisor.resize('session-response', 110, 32)
    await vi.waitFor(() => {
      const current = findLastSentMessage<{ type: 'resize'; requestId: string }>(
        testProcess,
        'resize',
      )
      expect(current?.requestId).not.toBe(firstResize?.requestId)
    })
    const secondResize = findLastSentMessage<{ type: 'resize'; requestId: string }>(
      testProcess,
      'resize',
    )
    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'resize',
      requestId: secondResize?.requestId,
      ok: true,
      result: {
        sessionId: 'different-session',
        resize: { status: 'applied_unverified' },
      },
    })
    await expect(spoofedSession).rejects.toThrow('does not match its pending request')
    supervisor.dispose()
  })

  it('rejects a mismatched ready version before sending a spawn request', async () => {
    const issues: string[] = []
    const testProcess = new TestPtyHostProcess('host-instance-mismatch')
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: issue => issues.push(issue),
    })

    const spawnPromise = supervisor.spawn(spawnInput)
    testProcess.emitReady(999)

    await expect(spawnPromise).rejects.toThrow('protocol mismatch')
    expect(findLastSentMessage(testProcess, 'spawn')).toBeNull()
    expect(testProcess.killCalls).toBe(1)
    expect(issues.some(issue => issue.includes('protocol mismatch'))).toBe(true)
    supervisor.dispose()
  })

  it('retires a live host that changes its instance identity after ready', async () => {
    const testProcess = new TestPtyHostProcess('host-instance-original')
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
    })
    const exits: Array<{ sessionId: string; exitCode: number }> = []
    supervisor.onExit(event => exits.push(event))
    await completeSpawn(supervisor, testProcess, 'session-original')

    testProcess.emit('message', {
      type: 'ready',
      protocolVersion: 5,
      hostInstanceId: 'host-instance-replacement',
    })

    expect(testProcess.killCalls).toBe(1)
    expect(exits).toEqual([{ sessionId: 'session-original', exitCode: 1 }])
    await expect(supervisor.resize('session-original', 90, 26)).rejects.toThrow(
      'unknown active session',
    )
    supervisor.dispose()
  })

  it('ignores malformed, wrong-instance and unknown-session events without losing the session', async () => {
    const testProcess = new TestPtyHostProcess('host-instance-events')
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
    })
    const dataEvents: Array<{ sessionId: string; data: string }> = []
    const foregroundEvents: Array<{ sessionId: string }> = []
    supervisor.onData(event => dataEvents.push(event))
    supervisor.onForeground(event => foregroundEvents.push(event))
    await completeSpawn(supervisor, testProcess, 'session-events')

    testProcess.emitHostMessage({
      type: 'data',
      sessionId: 'session-events',
      data: 'malformed',
      extra: true,
    })
    testProcess.emitHostMessage(
      { type: 'data', sessionId: 'session-events', data: 'stale' },
      'stale-host-instance',
    )
    testProcess.emitHostMessage({ type: 'data', sessionId: 'unknown-session', data: 'unknown' })
    testProcess.emitHostMessage({
      type: 'foreground',
      sessionId: 'session-events',
      observedAtMs: 100,
      source: 'windows_exit_code',
      exitCode: null,
      availability: 'unavailable',
      agent: null,
      shellOnly: false,
    })
    testProcess.emitHostMessage({ type: 'data', sessionId: 'session-events', data: 'accepted' })
    testProcess.emitHostMessage({
      type: 'foreground',
      sessionId: 'session-events',
      observedAtMs: 101,
      source: 'process_scan',
      exitCode: null,
      availability: 'available',
      agent: 'codex',
      shellOnly: false,
    })

    expect(dataEvents).toEqual([{ sessionId: 'session-events', data: 'accepted' }])
    expect(foregroundEvents).toHaveLength(1)
    expect(foregroundEvents[0]).toMatchObject({ sessionId: 'session-events' })

    const resizePromise = supervisor.resize('session-events', 90, 26)
    await vi.waitFor(() => expect(findLastSentMessage(testProcess, 'resize')).not.toBeNull())
    const resizeRequest = findLastSentMessage<{ type: 'resize'; requestId: string }>(
      testProcess,
      'resize',
    )
    testProcess.emitHostMessage({
      type: 'response',
      requestType: 'resize',
      requestId: resizeRequest?.requestId,
      ok: true,
      result: { sessionId: 'session-events', resize: { status: 'applied_unverified' } },
    })
    await expect(resizePromise).resolves.toMatchObject({ status: 'applied_unverified' })
    supervisor.dispose()
  })

  it('rejects pending work and sends an instance-bound shutdown during cleanup', async () => {
    const testProcess = new TestPtyHostProcess('host-instance-cleanup')
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
    })

    const spawnPromise = supervisor.spawn(spawnInput)
    testProcess.emitReady()
    await vi.waitFor(() => expect(findLastSentMessage(testProcess, 'spawn')).not.toBeNull())
    supervisor.dispose()

    await expect(spawnPromise).rejects.toThrow('supervisor disposed')
    expect(
      findLastSentMessage<{ type: 'shutdown'; hostInstanceId: string }>(testProcess, 'shutdown'),
    ).toMatchObject({ hostInstanceId: 'host-instance-cleanup' })
    expect(testProcess.killCalls).toBe(1)
  })
})
