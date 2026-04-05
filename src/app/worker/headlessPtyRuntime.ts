import { fork } from 'node:child_process'
import { resolve } from 'node:path'
import { PtyHostSupervisor } from '../../platform/process/ptyHost/supervisor'

type SpawnSessionOptions = {
  cwd: string
  cols: number
  rows: number
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

export interface HeadlessPtyRuntime {
  spawnSession: (options: SpawnSessionOptions) => Promise<{ sessionId: string }>
  write: (sessionId: string, data: string) => void
  resize: (sessionId: string, cols: number, rows: number) => void
  kill: (sessionId: string) => void
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  dispose: () => void
}

export function createHeadlessPtyRuntime(options: { userDataPath: string }): HeadlessPtyRuntime {
  const logsDir = resolve(options.userDataPath, 'logs')
  const logFilePath = resolve(logsDir, 'pty-host.log')

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

  return {
    spawnSession: async input => await supervisor.spawn(input),
    write: (sessionId, data) => {
      supervisor.write(sessionId, data)
    },
    resize: (sessionId, cols, rows) => {
      supervisor.resize(sessionId, cols, rows)
    },
    kill: sessionId => {
      supervisor.kill(sessionId)
    },
    onData: listener => supervisor.onData(listener),
    onExit: listener => supervisor.onExit(listener),
    dispose: () => {
      supervisor.dispose()
    },
  }
}
