import { fork } from 'node:child_process'
import { resolve } from 'node:path'
import { PtyHostSupervisor } from '../../platform/process/ptyHost/supervisor'
import type {
  TerminalGeometryCommitReason,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../shared/contracts/dto'
import {
  createSessionStateWatcherController,
  type SessionStateWatcherStartInput,
} from '../../contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import { isDebugCrashHostEnabled } from '../../contexts/terminal/presentation/main-ipc/debugCrashHost'
import { TerminalProfileResolver } from '../../platform/terminal/TerminalProfileResolver'
import type { ListTerminalProfilesResult } from '../../shared/contracts/dto'

type SpawnSessionOptions = {
  cwd: string
  cols: number
  rows: number
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

export interface HeadlessPtyRuntime {
  listProfiles: () => Promise<ListTerminalProfilesResult>
  spawnSession: (options: SpawnSessionOptions) => Promise<{ sessionId: string }>
  write: (sessionId: string, data: string) => void
  resize: (
    sessionId: string,
    cols: number,
    rows: number,
    reason?: TerminalGeometryCommitReason,
  ) => void
  kill: (sessionId: string) => void
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  onState: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
  startSessionStateWatcher: (input: SessionStateWatcherStartInput) => void
  debugCrashHost?: () => void
  dispose: () => void
}

export function createHeadlessPtyRuntime(options: { userDataPath: string }): HeadlessPtyRuntime {
  const logsDir = resolve(options.userDataPath, 'logs')
  const logFilePath = resolve(logsDir, 'pty-host.log')
  const debugCrashHostEnabled = isDebugCrashHostEnabled()
  const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  const exitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const stateListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const metadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  const profileResolver = new TerminalProfileResolver()

  const sessionStateWatcher = createSessionStateWatcherController({
    sendToAllWindows: () => undefined,
    reportIssue: message => {
      process.stderr.write(`${message}\n`)
    },
    onState: event => {
      stateListeners.forEach(listener => listener(event))
    },
    onMetadata: event => {
      metadataListeners.forEach(listener => listener(event))
    },
  })

  const supervisor = new PtyHostSupervisor({
    baseDir: __dirname,
    logFilePath,
    createProcess: modulePath => {
      const child = fork(modulePath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env },
      })

      return {
        on: (event, listener) => {
          if (event === 'message') {
            child.on('message', listener)
            return
          }

          child.on('exit', listener)
        },
        postMessage: message => {
          child.send?.(message)
        },
        kill: () => {
          return child.kill()
        },
        stdout: child.stdout ?? null,
        stderr: child.stderr ?? null,
        pid: child.pid,
      }
    },
  })

  const disposeDataListener = supervisor.onData(event => {
    dataListeners.forEach(listener => listener(event))
  })

  const disposeExitListener = supervisor.onExit(event => {
    sessionStateWatcher.disposeSession(event.sessionId)
    exitListeners.forEach(listener => listener(event))
  })

  return {
    listProfiles: async () => await profileResolver.listProfiles(),
    spawnSession: async input => await supervisor.spawn(input),
    write: (sessionId, data) => {
      supervisor.write(sessionId, data)
      sessionStateWatcher.noteInteraction(sessionId, data)
    },
    resize: (sessionId, cols, rows, _reason) => {
      void _reason
      supervisor.resize(sessionId, cols, rows)
    },
    kill: sessionId => {
      sessionStateWatcher.disposeSession(sessionId)
      supervisor.kill(sessionId)
    },
    onData: listener => {
      dataListeners.add(listener)
      return () => {
        dataListeners.delete(listener)
      }
    },
    onExit: listener => {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    },
    onState: listener => {
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },
    onMetadata: listener => {
      metadataListeners.add(listener)
      return () => {
        metadataListeners.delete(listener)
      }
    },
    startSessionStateWatcher: input => {
      sessionStateWatcher.start(input)
    },
    ...(debugCrashHostEnabled
      ? {
          debugCrashHost: () => {
            supervisor.crash()
          },
        }
      : {}),
    dispose: () => {
      disposeDataListener()
      disposeExitListener()
      dataListeners.clear()
      exitListeners.clear()
      stateListeners.clear()
      metadataListeners.clear()
      sessionStateWatcher.dispose()
      supervisor.dispose()
    },
  }
}
