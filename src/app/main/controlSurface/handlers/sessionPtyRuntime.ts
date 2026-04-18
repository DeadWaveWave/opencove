import type { SessionStateWatcherStartInput } from '../../../../contexts/terminal/presentation/main-ipc/sessionStateWatcher'

export interface ControlSurfacePtyRuntime {
  spawnSession: (options: {
    cwd: string
    cols: number
    rows: number
    command: string
    args: string[]
    env?: NodeJS.ProcessEnv
  }) => Promise<{ sessionId: string }>
  write: (sessionId: string, data: string) => void
  resize: (sessionId: string, cols: number, rows: number) => void
  kill: (sessionId: string) => void
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  startSessionStateWatcher?: (input: SessionStateWatcherStartInput) => void
}
