import type { SessionStateWatcherStartInput } from '../../../../contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import type {
  ListTerminalProfilesResult,
  PresentationSnapshotTerminalResult,
  ResizeTerminalInput,
  TerminalGeometryCommitResult,
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
  resize: (input: ResizeTerminalInput) => Promise<TerminalGeometryCommitResult>
  kill: (sessionId: string) => void
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  onState?: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  onMetadata?: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
  onPresentationReset?: (
    listener: (event: {
      sessionId: string
      snapshot: PresentationSnapshotTerminalResult
    }) => void | Promise<void>,
  ) => () => void
  onPresentationResetCommitted?: (
    listener: (event: { sessionId: string; committed: boolean }) => void,
  ) => () => void
  /** Freezes and drains runtime-owned presentation recovery before event listeners are removed. */
  drainPresentationRecovery?: () => Promise<void>
  startSessionStateWatcher?: (input: SessionStateWatcherStartInput) => void
  debugCrashHost?: () => void | Promise<void>
}
