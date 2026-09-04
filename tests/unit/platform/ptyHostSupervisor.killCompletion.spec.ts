import { describe, expect, it, vi } from 'vitest'
import { PtyHostSupervisor } from '@platform/process/ptyHost/supervisor'
import { TestPtyHostProcess, waitForSentMessage } from './ptyHostSupervisor.testSupport'

describe('PtyHostSupervisor explicit kill completion', () => {
  it('publishes trailing data and one real exit after requesting exact-session termination', async () => {
    const process = new TestPtyHostProcess('host-kill-completion')
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => process,
      reportIssue: vi.fn(),
    })
    const events: Array<{ type: 'data' | 'exit'; value: string | number }> = []
    supervisor.onData(event => events.push({ type: 'data', value: event.data }))
    supervisor.onExit(event => events.push({ type: 'exit', value: event.exitCode }))

    const spawning = supervisor.spawn({
      command: '/bin/zsh',
      args: [],
      cwd: '/',
      cols: 80,
      rows: 24,
    })
    const spawnRequestPromise = waitForSentMessage<{ type: 'spawn'; requestId: string }>(
      process,
      'spawn',
    )
    process.emitReady()
    const spawnRequest = await spawnRequestPromise
    process.emitHostMessage({
      type: 'response',
      requestType: 'spawn',
      requestId: spawnRequest.requestId,
      ok: true,
      result: { sessionId: 'session-killed' },
    })
    await spawning

    supervisor.kill('session-killed')
    expect(await waitForSentMessage(process, 'kill')).toMatchObject({
      sessionId: 'session-killed',
    })
    process.emitHostMessage({
      type: 'data',
      sessionId: 'session-killed',
      data: 'trailing output',
    })
    process.emitHostMessage({
      type: 'exit',
      sessionId: 'session-killed',
      exitCode: 143,
    })
    process.emitHostMessage({
      type: 'exit',
      sessionId: 'session-killed',
      exitCode: 143,
    })

    expect(events).toEqual([
      { type: 'data', value: 'trailing output' },
      { type: 'exit', value: 143 },
    ])
    supervisor.dispose()
  })
})
