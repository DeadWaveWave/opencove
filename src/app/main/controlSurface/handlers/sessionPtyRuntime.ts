import type { SessionStateWatcherStartInput } from '../../../../contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import type {
  ListTerminalProfilesResult,
  TerminalGeometryCommitReason,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'

export interface ControlSurfacePtyRuntime {
  listProfiles?: () => Promise<ListTerminalProfilesResult>
  spawnSession: (options: {
    cwd: string
    cols: number
    rows: number
    command: string
    args: string[]
    env?: NodeJS.ProcessEnv
  }) => Promise<{ sessionId: string }>
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
  onState?: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  onMetadata?: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
  startSessionStateWatcher?: (input: SessionStateWatcherStartInput) => void
  debugCrashHost?: () => void | Promise<void>
}
