import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalForegroundEvent,
  TerminalSessionStateEvent,
} from '../../../src/shared/contracts/dto'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'

afterEach(() => {
  vi.doUnmock('../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher')
  vi.doUnmock('../../../src/platform/terminal/TerminalProfileResolver')
  vi.resetModules()
})

describe('headless PTY runtime', () => {
  it('starts session watchers and forwards watcher events through the worker runtime', async () => {
    vi.resetModules()
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      const watcherStart = vi.fn()
      const watcherNoteInteraction = vi.fn()
      const watcherDisposeSession = vi.fn()
      const watcherDispose = vi.fn()

      let emitState: ((event: { sessionId: string; state: 'working' | 'standby' }) => void) | null =
        null
      let emitMetadata:
        | ((event: { sessionId: string; resumeSessionId: string | null }) => void)
        | null = null

      const processEngine = new FakeTerminalProcessEngine()
      processEngine.spawn
        .mockResolvedValueOnce({ sessionId: 'session-2' })
        .mockResolvedValue({ sessionId: 'session-1' })

      vi.doMock('../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher', () => ({
        createSessionStateWatcherController: vi.fn(options => {
          emitState = options.onState ?? null
          emitMetadata = options.onMetadata ?? null

          return {
            start: watcherStart,
            noteInteraction: watcherNoteInteraction,
            disposeSession: watcherDisposeSession,
            dispose: watcherDispose,
          }
        }),
      }))

      const { createHeadlessPtyRuntime } =
        await import('../../../src/app/worker/headlessPtyRuntime')

      const runtime = createHeadlessPtyRuntime({
        processEngine,
      })

      const observedData: Array<{ sessionId: string; data: string }> = []
      const observedExit: Array<{ sessionId: string; exitCode: number }> = []
      const observedForeground: TerminalForegroundEvent[] = []
      const observedState: TerminalSessionStateEvent[] = []
      const observedMetadata: Array<{ sessionId: string; resumeSessionId: string | null }> = []

      runtime.onData(event => {
        observedData.push(event)
      })
      runtime.onExit(event => {
        observedExit.push(event)
      })
      runtime.onForeground(event => {
        observedForeground.push(event)
      })
      const stateListener = vi.fn((event: TerminalSessionStateEvent) => {
        observedState.push(event)
      })
      runtime.onState(stateListener)
      runtime.onMetadata(event => {
        observedMetadata.push(event)
      })

      await runtime.spawnSession({
        cwd: '/tmp/workspace',
        cols: 80,
        rows: 24,
        command: 'claude',
        args: [],
        env: {
          EXISTING: 'value',
          OPENCOVE_CLAUDE_HOOK_ENDPOINT: 'http://127.0.0.1:1234/hooks/claude',
          OPENCOVE_CLAUDE_HOOK_TOKEN: 'token-1',
        },
        agentProvider: 'claude-code',
        initialAgentState: 'working',
        hookInstallState: 'installed',
      })
      await runtime.spawnSession({
        cwd: '/tmp/workspace',
        cols: 80,
        rows: 24,
        command: 'codex',
        args: [],
        env: {
          EXISTING: 'codex-value',
          OPENCOVE_CODEX_HOOK_ENDPOINT: 'http://127.0.0.1:5678/hooks/codex',
          OPENCOVE_CODEX_HOOK_TOKEN: 'reserved-token',
        },
        agentProvider: 'codex',
        initialAgentState: 'working',
        hookInstallState: 'installed',
      })

      runtime.startSessionStateWatcher({
        sessionId: 'session-2',
        provider: 'claude-code',
        cwd: '/tmp/workspace',
        launchMode: 'new',
        resumeSessionId: null,
        startedAtMs: Date.now(),
      })

      runtime.startSessionStateWatcher({
        sessionId: 'session-1',
        provider: 'codex',
        cwd: '/tmp/workspace',
        launchMode: 'new',
        resumeSessionId: null,
        startedAtMs: Date.now(),
      })

      expect(watcherStart).toHaveBeenNthCalledWith(1, {
        sessionId: 'session-2',
        provider: 'claude-code',
        cwd: '/tmp/workspace',
        launchMode: 'new',
        resumeSessionId: null,
        startedAtMs: expect.any(Number),
      })
      expect(watcherStart).toHaveBeenNthCalledWith(2, {
        sessionId: 'session-1',
        provider: 'codex',
        cwd: '/tmp/workspace',
        launchMode: 'new',
        resumeSessionId: null,
        startedAtMs: expect.any(Number),
      })

      processEngine.emitData({ sessionId: 'session-1', data: 'hello from worker\n\u001b[6n' })
      emitState?.({ sessionId: 'session-1', state: 'working' })
      emitMetadata?.({ sessionId: 'session-1', resumeSessionId: 'resume-session-1' })
      processEngine.emitForeground({
        sessionId: 'session-1',
        observedAtMs: 42,
        source: 'process_scan',
        exitCode: null,
        availability: 'available',
        agent: null,
        shellOnly: true,
      })
      processEngine.emitExit({ sessionId: 'session-1', exitCode: 0 })

      runtime.write('session-1', '\r')
      runtime.probeForeground('session-1')
      await runtime.resize({
        sessionId: 'session-1',
        cols: 120,
        rows: 40,
        reason: 'frame_commit',
        operationId: 'operation-1',
      })
      runtime.kill('session-2')
      runtime.debugCrashHost?.()
      runtime.dispose()

      expect(observedData).toEqual([{ sessionId: 'session-1', data: 'hello from worker\n' }])
      expect(observedState).toEqual([
        {
          sessionId: 'session-2',
          state: 'working',
          source: 'launch',
          hookInstallState: 'installed',
        },
        {
          sessionId: 'session-1',
          state: 'working',
          source: 'launch',
          hookInstallState: 'installed',
        },
        {
          sessionId: 'session-1',
          state: 'working',
          source: 'session_file',
          hookInstallState: 'installed',
        },
        {
          sessionId: 'session-1',
          state: 'standby',
          source: 'codex_hook',
          hookInstallState: 'installed',
        },
        {
          sessionId: 'session-1',
          state: 'standby',
          source: 'codex_hook',
          hookInstallState: 'installed',
        },
      ])
      expect(observedForeground).toEqual([
        {
          sessionId: 'session-1',
          observedAtMs: 42,
          source: 'process_scan',
          exitCode: null,
          availability: 'available',
          agent: null,
          shellOnly: true,
        },
      ])
      expect(observedMetadata).toEqual([
        { sessionId: 'session-1', resumeSessionId: 'resume-session-1' },
      ])
      expect(observedExit).toEqual([{ sessionId: 'session-1', exitCode: 0 }])
      expect(watcherNoteInteraction).toHaveBeenCalledWith('session-1', '\r')
      expect(watcherDisposeSession).toHaveBeenCalledWith('session-1')
      expect(watcherDisposeSession).toHaveBeenCalledWith('session-2')
      expect(processEngine.write).toHaveBeenCalledWith('session-1', '\r')
      expect(processEngine.write).toHaveBeenCalledWith('session-1', '\u001b[1;1R')
      expect(processEngine.probeForeground).toHaveBeenCalledWith('session-1')
      expect(processEngine.resize).toHaveBeenCalledWith('session-1', 120, 40)
      expect(processEngine.kill).toHaveBeenCalledWith('session-2')
      expect(processEngine.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          env: {
            EXISTING: 'value',
            OPENCOVE_CLAUDE_HOOK_ENDPOINT: 'http://127.0.0.1:1234/hooks/claude',
            OPENCOVE_CLAUDE_HOOK_TOKEN: 'token-1',
          },
        }),
      )
      expect(processEngine.spawn).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          env: {
            EXISTING: 'codex-value',
            OPENCOVE_CODEX_HOOK_ENDPOINT: 'http://127.0.0.1:5678/hooks/codex',
            OPENCOVE_CODEX_HOOK_TOKEN: 'reserved-token',
          },
        }),
      )
      expect(processEngine.crashForDebug).toHaveBeenCalledTimes(1)
      expect(watcherDispose).toHaveBeenCalledTimes(1)
      expect(processEngine.dispose).toHaveBeenCalledTimes(1)
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('does not publish post-spawn Agent state when exit completed before the spawn response', async () => {
    vi.resetModules()
    vi.doMock('../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher', () => ({
      createSessionStateWatcherController: vi.fn(() => ({
        start: vi.fn(),
        noteInteraction: vi.fn(),
        disposeSession: vi.fn(),
        dispose: vi.fn(),
      })),
    }))

    let resolveSpawn!: (value: { sessionId: string }) => void
    const processEngine = new FakeTerminalProcessEngine()
    processEngine.spawn.mockImplementation(
      async () =>
        await new Promise<{ sessionId: string }>(resolve => {
          resolveSpawn = resolve
        }),
    )

    const { createHeadlessPtyRuntime } = await import('../../../src/app/worker/headlessPtyRuntime')
    const runtime = createHeadlessPtyRuntime({ processEngine })
    const observedState: TerminalSessionStateEvent[] = []
    const observedExit: Array<{ sessionId: string; exitCode: number }> = []
    runtime.onState(event => observedState.push(event))
    runtime.onExit(event => observedExit.push(event))

    const spawning = runtime.spawnSession({
      cwd: '/tmp/workspace',
      cols: 80,
      rows: 24,
      command: 'claude',
      args: [],
      agentProvider: 'claude-code',
      initialAgentState: 'working',
      hookInstallState: 'installed',
    })

    processEngine.emitData({ sessionId: 'session-completed-before-response', data: 'done\n' })
    processEngine.emitExit({ sessionId: 'session-completed-before-response', exitCode: 0 })
    resolveSpawn({ sessionId: 'session-completed-before-response' })

    await expect(spawning).rejects.toThrow('completed before spawn registration')
    expect(observedState).toEqual([])
    expect(observedExit).toEqual([{ sessionId: 'session-completed-before-response', exitCode: 0 }])
    runtime.dispose()
  })

  it('retires the exact session returned after headless runtime disposal', async () => {
    vi.resetModules()
    let resolveSpawn!: (value: { sessionId: string }) => void
    const processEngine = new FakeTerminalProcessEngine()
    processEngine.spawn.mockImplementation(
      async () =>
        await new Promise<{ sessionId: string }>(resolve => {
          resolveSpawn = resolve
        }),
    )
    const { createHeadlessPtyRuntime } = await import('../../../src/app/worker/headlessPtyRuntime')
    const runtime = createHeadlessPtyRuntime({ processEngine })

    const spawning = runtime.spawnSession({
      cwd: '/tmp/workspace',
      cols: 80,
      rows: 24,
      command: 'shell',
      args: [],
    })
    runtime.dispose()
    resolveSpawn({ sessionId: 'session-after-dispose' })

    await expect(spawning).rejects.toThrow('lost its owner before spawn registration')
    expect(processEngine.kill).toHaveBeenCalledTimes(1)
    expect(processEngine.kill).toHaveBeenCalledWith('session-after-dispose')
  })

  it('preserves registration and exact-session retirement failures after disposal', async () => {
    vi.resetModules()
    let resolveSpawn!: (value: { sessionId: string }) => void
    const retirementError = new Error('exact session retirement failed')
    const processEngine = new FakeTerminalProcessEngine()
    processEngine.spawn.mockImplementation(
      async () =>
        await new Promise<{ sessionId: string }>(resolve => {
          resolveSpawn = resolve
        }),
    )
    processEngine.kill.mockImplementation(() => {
      throw retirementError
    })
    const { createHeadlessPtyRuntime } = await import('../../../src/app/worker/headlessPtyRuntime')
    const runtime = createHeadlessPtyRuntime({ processEngine })

    const spawning = runtime.spawnSession({
      cwd: '/tmp/workspace',
      cols: 80,
      rows: 24,
      command: 'shell',
      args: [],
    })
    runtime.dispose()
    resolveSpawn({ sessionId: 'session-cleanup-failure' })
    const error = await spawning.catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([expect.any(Error), retirementError])
    expect(((error as AggregateError).errors[0] as Error).message).toContain(
      'lost its owner before spawn registration',
    )
    expect(processEngine.kill).toHaveBeenCalledWith('session-cleanup-failure')
  })

  it('exposes terminal profile discovery through the worker runtime', async () => {
    vi.resetModules()

    const listProfiles = vi.fn(async () => ({
      profiles: [{ id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' as const }],
      defaultProfileId: 'powershell',
    }))

    vi.doMock('../../../src/platform/terminal/TerminalProfileResolver', () => ({
      TerminalProfileResolver: class {
        public listProfiles = listProfiles
      },
    }))

    const { createHeadlessPtyRuntime } = await import('../../../src/app/worker/headlessPtyRuntime')

    const runtime = createHeadlessPtyRuntime({ processEngine: new FakeTerminalProcessEngine() })

    try {
      await expect(runtime.listProfiles()).resolves.toEqual({
        profiles: [{ id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' }],
        defaultProfileId: 'powershell',
      })
      expect(listProfiles).toHaveBeenCalledTimes(1)
    } finally {
      runtime.dispose()
    }
  })

  it('forwards child IPC send failures through the headless pty adapter callback', async () => {
    vi.resetModules()

    const observedErrors: Array<string> = []

    const child = new EventEmitter() as EventEmitter & {
      send: (
        message: unknown,
        sendHandle?: unknown,
        options?: unknown,
        callback?: (error: Error | null) => void,
      ) => void
      kill: () => boolean
      stdout: null
      stderr: null
      pid: number
    }

    let capturedSendCallback: ((error: Error | null) => void) | null = null
    child.send = (message, _sendHandle, _options, callback) => {
      const record =
        message && typeof message === 'object' ? (message as Record<string, unknown>) : null
      const messageType = typeof record?.type === 'string' ? record.type : null

      if (messageType === 'shutdown') {
        capturedSendCallback = callback ?? null
      }
    }
    child.kill = () => true
    child.stdout = null
    child.stderr = null
    child.pid = 3210

    const { createNodeChildPtyHostProcess } =
      await import('../../../src/platform/process/ptyHost/nodeProcessAdapter')

    const ptyHostProcess = createNodeChildPtyHostProcess(child)
    ptyHostProcess.postMessage({ type: 'shutdown' }, error => {
      if (error) {
        observedErrors.push(error.message)
      }
    })

    expect(typeof capturedSendCallback).toBe('function')
    capturedSendCallback?.(new Error('Channel closed'))

    expect(observedErrors).toEqual(['Channel closed'])
  })
})
