import { describe, expect, it, vi } from 'vitest'
import { PtyHostSupervisor } from '@platform/process/ptyHost/supervisor'
import { TestPtyHostProcess, waitForSentMessage } from './ptyHostSupervisor.testSupport'

describe('PtyHostSupervisor reverse response mismatch', () => {
  it('quarantines the exact host when a pending spawn receives a resize response', async () => {
    const process = new TestPtyHostProcess('host-reverse-mismatch')
    process.exitOnKill = false
    const createProcess = vi.fn(() => process)
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess,
      reportIssue: vi.fn(),
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
      requestType: 'resize',
      requestId: request.requestId,
      ok: true,
      result: {
        sessionId: 'unrelated-session',
        resize: { status: 'applied_verified', cols: 80, rows: 24 },
      },
    })

    await expect(spawning).rejects.toThrow('does not match its pending request')
    expect(process.killCalls).toBe(1)
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
})
