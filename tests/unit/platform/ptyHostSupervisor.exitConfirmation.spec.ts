import { afterEach, describe, expect, it, vi } from 'vitest'
import { PtyHostSupervisor } from '@platform/process/ptyHost/supervisor'
import { TestPtyHostProcess, waitForSentMessage } from './ptyHostSupervisor.testSupport'

afterEach(() => {
  vi.useRealTimers()
})

describe('PtyHostSupervisor exit confirmation', () => {
  it('settles an intentional crash only after the exact child confirms exit', async () => {
    const process = new TestPtyHostProcess('host-debug-crash')
    process.exitOnKill = false
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => process,
      reportIssue: () => undefined,
    })

    const spawning = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    const requestPromise = waitForSentMessage<{ type: 'spawn'; requestId: string }>(
      process,
      'spawn',
    )
    process.emitReady()
    const request = await requestPromise
    process.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: request.requestId,
      ok: true,
      result: { sessionId: 'session-before-debug-crash' },
    })
    await spawning

    let settled = false
    const crashCompletion = Promise.resolve(supervisor.crash()).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    process.emit('exit', 1)
    await crashCompletion
    expect(settled).toBe(true)
    supervisor.dispose()
  })

  it('does not replace a ready-timeout host until its exact child emits exit', async () => {
    vi.useFakeTimers()
    const firstProcess = new TestPtyHostProcess('host-ready-timeout')
    firstProcess.exitOnKill = false
    const secondProcess = new TestPtyHostProcess('host-after-confirmed-exit')
    const processes = [firstProcess, secondProcess]
    const createProcess = vi.fn(() => processes.shift() ?? secondProcess)
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess,
      reportIssue: () => undefined,
      readyTimeoutMs: 5,
    })

    try {
      const timedOut = supervisor.spawn({
        command: '/bin/zsh',
        args: [],
        cwd: '/',
        cols: 80,
        rows: 24,
      })
      const timeoutRejection = expect(timedOut).rejects.toThrow('prior host exit is unconfirmed')
      await vi.advanceTimersToNextTimerAsync()
      await timeoutRejection
      expect(firstProcess.killCalls).toBe(1)

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
      const recovered = supervisor.spawn({
        command: '/bin/zsh',
        args: [],
        cwd: '/',
        cols: 80,
        rows: 24,
      })
      await vi.advanceTimersToNextTimerAsync()
      const requestPromise = waitForSentMessage<{ type: 'spawn'; requestId: string }>(
        secondProcess,
        'spawn',
      )
      secondProcess.emitReady()
      const request = await requestPromise
      secondProcess.emitHostMessage({
        type: 'response',
        requestType: 'spawn',
        requestId: request.requestId,
        ok: true,
        result: { sessionId: 'session-after-confirmed-ready-timeout-exit' },
      })
      await expect(recovered).resolves.toEqual({
        sessionId: 'session-after-confirmed-ready-timeout-exit',
      })
    } finally {
      supervisor.dispose()
    }
  })
})
