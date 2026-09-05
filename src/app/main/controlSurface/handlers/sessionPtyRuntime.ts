import type { SessionStateWatcherStartInput } from '../../../../contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import type {
  AgentProviderId,
  ListTerminalProfilesResult,
  PresentationSnapshotTerminalResult,
  ResizeTerminalInput,
  TerminalForegroundEvent,
  TerminalGeometryCommitResult,
  TerminalAgentReexecInput,
  TerminalAgentReexecResult,
  AgentHookInstallState,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import type { AgentLaunchArtifactScope } from '../../../../contexts/agent/application/services/AgentLaunchArtifactScope'

export type TerminalAgentReexecRuntimeInput = TerminalAgentReexecInput & { operationId: string }

export interface ControlSurfacePtyRuntime {
  isIdle?: () => boolean
  listProfiles?: () => Promise<ListTerminalProfilesResult>
  spawnSession: (options: {
    cwd: string
    cols: number
    rows: number
    command: string
    args: string[]
    env?: NodeJS.ProcessEnv
    agentProvider?: AgentProviderId
    initialAgentState?: 'working' | 'standby'
    hookInstallState?: AgentHookInstallState
    launchArtifacts?: AgentLaunchArtifactScope
  }) => Promise<{ sessionId: string }>
  /** Waits until a newly spawned interactive shell can safely accept its first command. */
  waitForShellReady?: (sessionId: string) => Promise<void>
  write: (sessionId: string, data: string) => void
  probeForeground?: (sessionId: string) => void
  reexecAgent?: (input: TerminalAgentReexecRuntimeInput) => Promise<TerminalAgentReexecResult>
  resize: (input: ResizeTerminalInput) => Promise<TerminalGeometryCommitResult>
  kill: (sessionId: string) => void
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  /** Completion boundary: all runtime data for the session is delivered before this event. */
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  onForeground?: (listener: (event: TerminalForegroundEvent) => void) => () => void
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
  disposeSessionStateWatcher?: (sessionId: string) => void
  debugCrashHost?: () => void | Promise<void>
}
