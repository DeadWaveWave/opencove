import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalForegroundEvent,
  TerminalSessionStateEvent,
} from '../../../src/shared/contracts/dto'

afterEach(() => {
  vi.doUnmock('../../../src/platform/process/ptyHost/supervisor')
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
      const ptyDataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
      const ptyExitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()
      const ptyForegroundListeners = new Set<
        (event: {
          sessionId: string
          observedAtMs: number
          source: 'process_scan'
          availability: 'available'
          agent: null
          shellOnly: true
        }) => void
      >()

      const watcherStart = vi.fn()
      const watcherNoteInteraction = vi.fn()
      const watcherDisposeSession = vi.fn()
      const watcherDispose = vi.fn()

      let emitState: ((event: { sessionId: string; state: 'working' | 'standby' }) => void) | null =
        null
      let emitMetadata:
        | ((event: { sessionId: string; resumeSessionId: string | null }) => void)
        | null = null

      let lastSupervisor: {
        spawn: ReturnType<typeof vi.fn>
        write: ReturnType<typeof vi.fn>
        resize: ReturnType<typeof vi.fn>
        kill: ReturnType<typeof vi.fn>
        crash: ReturnType<typeof vi.fn>
        dispose: ReturnType<typeof vi.fn>
      } | null = null

      class MockPtyHostSupervisor {
        public write = vi.fn()
        public resize = vi.fn()
        public kill = vi.fn()
        public crash = vi.fn()
        public dispose = vi.fn()
        public spawn = vi
          .fn()
          .mockResolvedValueOnce({ sessionId: 'session-2' })
          .mockResolvedValue({ sessionId: 'session-1' })

        public constructor() {
          lastSupervisor = {
            spawn: this.spawn,
            write: this.write,
            resize: this.resize,
            kill: this.kill,
            crash: this.crash,
            dispose: this.dispose,
          }
        }

        public onData(listener: (event: { sessionId: string; data: string }) => void): () => void {
          ptyDataListeners.add(listener)
          return () => {
            ptyDataListeners.delete(listener)
          }
        }

        public onExit(
          listener: (event: { sessionId: string; exitCode: number }) => void,
        ): () => void {
          ptyExitListeners.add(listener)
          return () => {
            ptyExitListeners.delete(listener)
          }
        }

        public onForeground(
          listener: (event: {
            sessionId: string
            observedAtMs: number
            source: 'process_scan'
            availability: 'available'
            agent: null
            shellOnly: true
          }) => void,
        ): () => void {
          ptyForegroundListeners.add(listener)
          return () => {
            ptyForegroundListeners.delete(listener)
          }
        }
      }

      vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
        PtyHostSupervisor: MockPtyHostSupervisor,
      }))

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

      let emitHookState: ((event: TerminalSessionStateEvent) => void) | null = null
      let emitCodexHookState: ((event: TerminalSessionStateEvent) => void) | null = null
      const hookCommit = vi.fn()
      const hookDisposeSession = vi.fn()
      const codexHookCommit = vi.fn()
      const codexHookDisposeSession = vi.fn()
      const claudeHookChannel = {
        start: vi.fn(async () => undefined),
        reserveSpawn: vi.fn(async () => ({
          env: {
            OPENCOVE_CLAUDE_HOOK_ENDPOINT: 'http://127.0.0.1:1234/hooks/claude',
            OPENCOVE_CLAUDE_HOOK_TOKEN: 'token-1',
          },
          installState: 'installed' as const,
          usesHook: true,
          commit: hookCommit,
          dispose: vi.fn(),
        })),
        onState: vi.fn((listener: (event: TerminalSessionStateEvent) => void) => {
          emitHookState = listener
          return () => undefined
        }),
        disposeSession: hookDisposeSession,
        getInstallState: vi.fn(() => 'installed' as const),
        getEndpoint: vi.fn(() => 'http://127.0.0.1:1234/hooks/claude'),
        dispose: vi.fn(async () => undefined),
      }
      const codexHookChannel = {
        ...claudeHookChannel,
        reserveSpawn: vi.fn(async () => ({
          env: {
            OPENCOVE_CODEX_HOOK_ENDPOINT: 'http://127.0.0.1:5678/hooks/codex',
            OPENCOVE_CODEX_HOOK_TOKEN: 'reserved-token',
          },
          installState: 'installed' as const,
          usesHook: true,
          commit: codexHookCommit,
          dispose: vi.fn(),
        })),
        onState: vi.fn((listener: (event: TerminalSessionStateEvent) => void) => {
          emitCodexHookState = listener
          return () => undefined
        }),
        disposeSession: codexHookDisposeSession,
        getEndpoint: vi.fn(() => 'http://127.0.0.1:5678/hooks/codex'),
      }
      const runtime = createHeadlessPtyRuntime({
        userDataPath: '/tmp/opencove-headless-runtime',
        agentHookChannels: { 'claude-code': claudeHookChannel, codex: codexHookChannel },
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
        env: { EXISTING: 'value' },
        agentProvider: 'claude-code',
        initialAgentState: 'working',
      })
      await runtime.spawnSession({
        cwd: '/tmp/workspace',
        cols: 80,
        rows: 24,
        command: 'codex',
        args: [],
        env: { EXISTING: 'codex-value', OPENCOVE_CODEX_HOOK_TOKEN: 'caller-token' },
        agentProvider: 'codex',
        initialAgentState: 'working',
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

      ptyDataListeners.forEach(listener => {
        listener({ sessionId: 'session-1', data: 'hello from worker\n\u001b[6n' })
      })
      emitState?.({ sessionId: 'session-1', state: 'working' })
      emitHookState?.({
        sessionId: 'session-2',
        state: 'waiting',
        source: 'claude_hook',
        hookInstallState: 'installed',
      })
      emitCodexHookState?.({
        sessionId: 'session-1',
        state: 'waiting',
        source: 'codex_hook',
        hookInstallState: 'installed',
      })
      emitMetadata?.({ sessionId: 'session-1', resumeSessionId: 'resume-session-1' })
      ptyForegroundListeners.forEach(listener => {
        listener({
          sessionId: 'session-1',
          observedAtMs: 42,
          source: 'process_scan',
          availability: 'available',
          agent: null,
          shellOnly: true,
        })
      })
      ptyExitListeners.forEach(listener => {
        listener({ sessionId: 'session-1', exitCode: 0 })
      })

      runtime.write('session-1', '\r')
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
          sessionId: 'session-2',
          state: 'waiting',
          source: 'claude_hook',
          hookInstallState: 'installed',
        },
        {
          sessionId: 'session-1',
          state: 'waiting',
          source: 'codex_hook',
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
      expect(lastSupervisor?.write).toHaveBeenCalledWith('session-1', '\r')
      expect(lastSupervisor?.write).toHaveBeenCalledWith('session-1', '\u001b[1;1R')
      expect(lastSupervisor?.resize).toHaveBeenCalledWith('session-1', 120, 40)
      expect(lastSupervisor?.kill).toHaveBeenCalledWith('session-2')
      expect(lastSupervisor?.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          env: {
            EXISTING: 'value',
            OPENCOVE_CLAUDE_HOOK_ENDPOINT: 'http://127.0.0.1:1234/hooks/claude',
            OPENCOVE_CLAUDE_HOOK_TOKEN: 'token-1',
            OPENCOVE_CODEX_HOOK_ENDPOINT: 'http://127.0.0.1:5678/hooks/codex',
            OPENCOVE_CODEX_HOOK_TOKEN: 'reserved-token',
          },
        }),
      )
      expect(lastSupervisor?.spawn).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          env: {
            EXISTING: 'codex-value',
            OPENCOVE_CODEX_HOOK_ENDPOINT: 'http://127.0.0.1:5678/hooks/codex',
            OPENCOVE_CODEX_HOOK_TOKEN: 'reserved-token',
          },
        }),
      )
      expect(hookCommit).toHaveBeenCalledWith('session-2')
      expect(codexHookCommit).toHaveBeenCalledWith('session-1')
      expect(stateListener.mock.invocationCallOrder[0]).toBeLessThan(
        hookCommit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      )
      expect(hookDisposeSession).toHaveBeenCalledWith('session-2')
      expect(codexHookDisposeSession).toHaveBeenCalledWith('session-1')
      expect(lastSupervisor?.crash).toHaveBeenCalledTimes(1)
      expect(watcherDispose).toHaveBeenCalledTimes(1)
      expect(lastSupervisor?.dispose).toHaveBeenCalledTimes(1)
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
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

    const runtime = createHeadlessPtyRuntime({ userDataPath: '/tmp/opencove-headless-runtime' })

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
