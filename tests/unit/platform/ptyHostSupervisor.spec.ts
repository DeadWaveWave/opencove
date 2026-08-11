import { PtyHostSupervisor } from '@platform/process/ptyHost/supervisor'
import { findLastSentMessage, TestPtyHostProcess } from './ptyHostSupervisor.testSupport'

describe('PtyHostSupervisor', () => {
  it('spawns sessions after ready + response', async () => {
    const testProcess = new TestPtyHostProcess()
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
    })

    const spawnPromise = supervisor.spawn({
      command: '/bin/zsh',
      args: ['-lc', 'echo OK'],
      cwd: '/',
      env: { FOO: 'bar' },
      cols: 80,
      rows: 24,
    })

    testProcess.emit('message', { type: 'ready', protocolVersion: 3 })
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

      testProcess.emit('message', { type: 'ready', protocolVersion: 3 })
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
      reportIssue: () => undefined,
    })

    const spawnPromise = supervisor.spawn({
      command: '/Applications/OpenCove.app/Contents/MacOS/OpenCove',
      args: ['/tmp/test-agent-session-stub.mjs'],
      cwd: '/',
      env: { ELECTRON_RUN_AS_NODE: '1' },
      cols: 80,
      rows: 24,
    })

    testProcess.emit('message', { type: 'ready', protocolVersion: 3 })
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

    testProcess.emit('message', { type: 'ready', protocolVersion: 3 })
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

  it('waits for the PTY host resize response', async () => {
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
    testProcess.emit('message', { type: 'ready', protocolVersion: 3 })
    await new Promise(resolve => setTimeout(resolve, 0))
    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      testProcess,
      'spawn',
    )
    testProcess.emit('message', {
      type: 'response',
      requestId: sentSpawn?.requestId,
      ok: true,
      result: { sessionId: 's-resize' },
    })
    await spawnPromise

    const resizePromise = supervisor.resize('s-resize', 100, 32)
    await new Promise(resolve => setTimeout(resolve, 0))
    const sentResize = findLastSentMessage<{
      type: 'resize'
      requestId: string
      sessionId: string
      cols: number
      rows: number
    }>(testProcess, 'resize')

    expect(sentResize).toMatchObject({
      type: 'resize',
      sessionId: 's-resize',
      cols: 100,
      rows: 32,
    })

    testProcess.emit('message', {
      type: 'response',
      requestId: sentResize?.requestId,
      ok: true,
      result: {
        sessionId: 's-resize',
        resize: { status: 'applied_verified', cols: 91, rows: 27 },
      },
    })

    await expect(resizePromise).resolves.toEqual({
      sessionId: 's-resize',
      status: 'applied_verified',
      cols: 91,
      rows: 27,
    })
    supervisor.dispose()
  })

  it('rejects a resize response that omits applied geometry instead of echoing the request', async () => {
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
    testProcess.emit('message', { type: 'ready', protocolVersion: 3 })
    await vi.waitFor(() => expect(findLastSentMessage(testProcess, 'spawn')).not.toBeNull())
    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      testProcess,
      'spawn',
    )
    testProcess.emit('message', {
      type: 'response',
      requestId: sentSpawn?.requestId,
      ok: true,
      result: { sessionId: 's-missing-geometry' },
    })
    await spawnPromise

    const resizePromise = supervisor.resize('s-missing-geometry', 120, 40)
    await vi.waitFor(() => expect(findLastSentMessage(testProcess, 'resize')).not.toBeNull())
    const sentResize = findLastSentMessage<{ type: 'resize'; requestId: string }>(
      testProcess,
      'resize',
    )
    testProcess.emit('message', {
      type: 'response',
      requestId: sentResize?.requestId,
      ok: true,
      result: { sessionId: 's-missing-geometry' },
    })

    await expect(resizePromise).rejects.toThrow('missing applied geometry status')
    supervisor.dispose()
  })

  it('ignores shutdown send failures while disposing', async () => {
    const testProcess = new TestPtyHostProcess()
    testProcess.failPostMessageTypes.add('shutdown')

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

    testProcess.emit('message', { type: 'ready', protocolVersion: 3 })
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      testProcess,
      'spawn',
    )
    testProcess.emit('message', {
      type: 'response',
      requestId: sentSpawn?.requestId,
      ok: true,
      result: { sessionId: 's-shutdown-failure' },
    })

    await expect(spawnPromise).resolves.toEqual({ sessionId: 's-shutdown-failure' })

    expect(() => {
      supervisor.dispose()
    }).not.toThrow()
    expect(testProcess.killCalls).toBe(1)
  })

  it('treats a send failure as host loss during runtime writes', async () => {
    const testProcess = new TestPtyHostProcess()
    const supervisor = new PtyHostSupervisor({
      baseDir: '/',
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess: () => testProcess,
      reportIssue: () => undefined,
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

    testProcess.emit('message', { type: 'ready', protocolVersion: 3 })
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentSpawn = findLastSentMessage<{ type: 'spawn'; requestId: string }>(
      testProcess,
      'spawn',
    )
    testProcess.emit('message', {
      type: 'response',
      requestId: sentSpawn?.requestId,
      ok: true,
      result: { sessionId: 's-write-failure' },
    })

    await expect(spawnPromise).resolves.toEqual({ sessionId: 's-write-failure' })

    testProcess.failPostMessageTypes.add('write')
    supervisor.write('s-write-failure', 'echo test')

    expect(observedExits).toContainEqual({ sessionId: 's-write-failure', exitCode: 1 })

    supervisor.dispose()
  })
})
