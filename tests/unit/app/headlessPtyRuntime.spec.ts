import { afterEach, describe, expect, it, vi } from 'vitest'

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
        public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))

        public constructor() {
          lastSupervisor = {
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

      const runtime = createHeadlessPtyRuntime({ userDataPath: '/tmp/opencove-headless-runtime' })

      const observedData: Array<{ sessionId: string; data: string }> = []
      const observedExit: Array<{ sessionId: string; exitCode: number }> = []
      const observedState: Array<{ sessionId: string; state: 'working' | 'standby' }> = []
      const observedMetadata: Array<{ sessionId: string; resumeSessionId: string | null }> = []

      runtime.onData(event => {
        observedData.push(event)
      })
      runtime.onExit(event => {
        observedExit.push(event)
      })
      runtime.onState(event => {
        observedState.push(event)
      })
      runtime.onMetadata(event => {
        observedMetadata.push(event)
      })

      runtime.startSessionStateWatcher({
        sessionId: 'session-1',
        provider: 'codex',
        cwd: '/tmp/workspace',
        launchMode: 'new',
        resumeSessionId: null,
        startedAtMs: Date.now(),
      })

      expect(watcherStart).toHaveBeenCalledWith({
        sessionId: 'session-1',
        provider: 'codex',
        cwd: '/tmp/workspace',
        launchMode: 'new',
        resumeSessionId: null,
        startedAtMs: expect.any(Number),
      })

      ptyDataListeners.forEach(listener => {
        listener({ sessionId: 'session-1', data: 'hello from worker\n' })
      })
      emitState?.({ sessionId: 'session-1', state: 'working' })
      emitMetadata?.({ sessionId: 'session-1', resumeSessionId: 'resume-session-1' })
      ptyExitListeners.forEach(listener => {
        listener({ sessionId: 'session-1', exitCode: 0 })
      })

      runtime.write('session-1', '\r')
      runtime.resize('session-1', 120, 40)
      runtime.kill('session-2')
      runtime.debugCrashHost?.()
      runtime.dispose()

      expect(observedData).toEqual([{ sessionId: 'session-1', data: 'hello from worker\n' }])
      expect(observedState).toEqual([{ sessionId: 'session-1', state: 'working' }])
      expect(observedMetadata).toEqual([
        { sessionId: 'session-1', resumeSessionId: 'resume-session-1' },
      ])
      expect(observedExit).toEqual([{ sessionId: 'session-1', exitCode: 0 }])
      expect(watcherNoteInteraction).toHaveBeenCalledWith('session-1', '\r')
      expect(watcherDisposeSession).toHaveBeenCalledWith('session-1')
      expect(watcherDisposeSession).toHaveBeenCalledWith('session-2')
      expect(lastSupervisor?.write).toHaveBeenCalledWith('session-1', '\r')
      expect(lastSupervisor?.resize).toHaveBeenCalledWith('session-1', 120, 40)
      expect(lastSupervisor?.kill).toHaveBeenCalledWith('session-2')
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
})
