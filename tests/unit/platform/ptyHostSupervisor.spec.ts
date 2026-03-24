import { EventEmitter } from 'node:events'
import { PtyHostSupervisor } from '@platform/process/ptyHost/supervisor'
import type { PtyHostProcess } from '@platform/process/ptyHost/supervisor'

class TestPtyHostProcess extends EventEmitter implements PtyHostProcess {
  public readonly sentMessages: unknown[] = []
  public readonly stdout = null
  public readonly stderr = null
  public pid: number | undefined = 1234

  public postMessage(message: unknown): void {
    this.sentMessages.push(message)
  }

  public kill(): boolean {
    this.emit('exit', 0)
    return true
  }
}

function findLastSentMessage<T extends { type: string }>(
  process: TestPtyHostProcess,
  type: T['type'],
): T | null {
  for (let index = process.sentMessages.length - 1; index >= 0; index -= 1) {
    const message = process.sentMessages[index]
    if (!message || typeof message !== 'object') {
      continue
    }

    const record = message as Record<string, unknown>
    if (record.type === type) {
      return message as T
    }
  }

  return null
}

describe('PtyHostSupervisor', () => {
  it('spawns sessions after ready + response', async () => {
    const testProcess = new TestPtyHostProcess()
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
    })

    const spawnPromise = supervisor.spawn({
      command: '/bin/zsh',
      args: ['-lc', 'echo OK'],
      cwd: '/',
      env: { FOO: 'bar' },
      cols: 80,
      rows: 24,
    })

    testProcess.emit('message', { type: 'ready', protocolVersion: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      testProcess,
      'spawn',
    )
    expect(sentSpawn?.requestId).toBeTruthy()

    testProcess.emit('message', {
      type: 'response',
      requestId: sentSpawn?.requestId,
      ok: true,
      result: { sessionId: 's1' },
    })

    await expect(spawnPromise).resolves.toEqual({ sessionId: 's1' })

    supervisor.dispose()
  })

  it('emits exit for active sessions when host exits', async () => {
    const testProcess = new TestPtyHostProcess()
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
    })

    const observedExits: Array<{ sessionId: string; exitCode: number }> = []
    supervisor.onExit(event => {
      observedExits.push(event)
    })

    const spawnPromise = supervisor.spawn({
      command: '/bin/zsh',
      args: ['-lc', 'echo OK'],
      cwd: '/',
      cols: 80,
      rows: 24,
    })

    testProcess.emit('message', { type: 'ready', protocolVersion: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      testProcess,
      'spawn',
    )
    testProcess.emit('message', {
      type: 'response',
      requestId: sentSpawn?.requestId,
      ok: true,
      result: { sessionId: 's2' },
    })

    await expect(spawnPromise).resolves.toEqual({ sessionId: 's2' })

    testProcess.emit('exit', 6)
    expect(observedExits).toContainEqual({ sessionId: 's2', exitCode: 6 })

    supervisor.dispose()
  })
})
