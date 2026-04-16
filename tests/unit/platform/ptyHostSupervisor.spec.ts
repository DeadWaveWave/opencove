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

  it('drops ELECTRON_RUN_AS_NODE from inherited env', async () => {
    const previousValue = process.env.ELECTRON_RUN_AS_NODE
    process.env.ELECTRON_RUN_AS_NODE = '1'

    try {
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
        cols: 80,
        rows: 24,
      })

      testProcess.emit('message', { type: 'ready', protocolVersion: 1 })
      await new Promise(resolve => setTimeout(resolve, 0))

      const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string; env?: unknown }>(
        testProcess,
        'spawn',
      )

      const resolvedEnv =
        sentSpawn && typeof sentSpawn.env === 'object' && sentSpawn.env !== null
          ? (sentSpawn.env as Record<string, unknown>)
          : null

      expect(resolvedEnv?.['ELECTRON_RUN_AS_NODE']).toBeUndefined()

      testProcess.emit('message', {
        type: 'response',
        requestId: sentSpawn?.requestId,
        ok: true,
        result: { sessionId: 's-env' },
      })

      await expect(spawnPromise).resolves.toEqual({ sessionId: 's-env' })

      supervisor.dispose()
    } finally {
      if (previousValue === undefined) {
        delete process.env.ELECTRON_RUN_AS_NODE
      } else {
        process.env.ELECTRON_RUN_AS_NODE = previousValue
      }
    }
  })

  it('preserves an explicit ELECTRON_RUN_AS_NODE override in spawn env', async () => {
    const testProcess = new TestPtyHostProcess()
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
    })

    const spawnPromise = supervisor.spawn({
      command: '/Applications/OpenCove.app/Contents/MacOS/OpenCove',
      args: ['/tmp/test-agent-session-stub.mjs'],
      cwd: '/',
      env: { ELECTRON_RUN_AS_NODE: '1' },
      cols: 80,
      rows: 24,
    })

    testProcess.emit('message', { type: 'ready', protocolVersion: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string; env?: unknown }>(
      testProcess,
      'spawn',
    )

    const resolvedEnv =
      sentSpawn && typeof sentSpawn.env === 'object' && sentSpawn.env !== null
        ? (sentSpawn.env as Record<string, unknown>)
        : null

    expect(resolvedEnv?.['ELECTRON_RUN_AS_NODE']).toBe('1')

    testProcess.emit('message', {
      type: 'response',
      requestId: sentSpawn?.requestId,
      ok: true,
      result: { sessionId: 's-explicit-env' },
    })

    await expect(spawnPromise).resolves.toEqual({ sessionId: 's-explicit-env' })

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
