import type { AgentLaunchMode, AgentProviderId } from './agent'

export interface PseudoTerminalSession {
  sessionId: string
}

export interface TerminalWindowsPty {
  backend: 'conpty'
  buildNumber: number
}

export type TerminalRuntimeKind = 'windows' | 'wsl' | 'posix'

export interface TerminalProfile {
  id: string
  label: string
  runtimeKind: TerminalRuntimeKind
}

export interface ListTerminalProfilesResult {
  profiles: TerminalProfile[]
  defaultProfileId: string | null
}

export interface SpawnTerminalInput {
  canvasNodeId?: string
  workspaceId?: string
  spaceId?: string
  cwd: string
  profileId?: string
  shell?: string
  command?: string | null
  args?: string[] | null
  cols: number
  rows: number
  env?: Record<string, string>
}

export interface SpawnTerminalInMountInput {
  canvasNodeId?: string
  workspaceId?: string
  spaceId?: string
  mountId: string
  cwdUri?: string | null
  profileId?: string | null
  shell?: string | null
  command?: string | null
  args?: string[] | null
  cols?: number | null
  rows?: number | null
  env?: Record<string, string> | null
}

export interface SpawnTerminalResult extends PseudoTerminalSession {
  profileId?: string | null
  runtimeKind?: TerminalRuntimeKind
}

export type TerminalWriteEncoding = 'utf8' | 'binary'

export interface WriteTerminalInput {
  sessionId: string
  data: string
  encoding?: TerminalWriteEncoding
}

export type TerminalGeometryCommitReason = 'frame_commit' | 'appearance_commit'

export interface TerminalPtyGeometry {
  cols: number
  rows: number
  revision?: number | null
}

export interface TerminalCanonicalPtyGeometry {
  cols: number
  rows: number
  revision: number | null
}

export type TerminalPtyRole = 'viewer' | 'controller'

export interface TerminalGeometryAuthority {
  role: TerminalPtyRole
  epoch: number
}

export type TerminalGeometryCommitStatus =
  | 'accepted'
  | 'accepted_unverified'
  | 'rejected_not_controller'
  | 'rejected_stale_authority'
  | 'superseded'
  | 'session_not_found'
  | 'runtime_failed'

export interface TerminalGeometryCommitResult {
  sessionId: string
  operationId: string
  status: TerminalGeometryCommitStatus
  changed: boolean
  geometry: TerminalCanonicalPtyGeometry | null
  authority: TerminalGeometryAuthority | null
}

export interface ResizeTerminalInput {
  sessionId: string
  cols: number
  rows: number
  reason: TerminalGeometryCommitReason
  operationId?: string
  baseGeometryRevision?: number | null
  authorityEpoch?: number | null
  /** @deprecated Compatibility only. Use operationId + baseGeometryRevision. */
  revision?: number | null
}

export interface KillTerminalInput {
  sessionId: string
}

export interface AttachTerminalInput {
  sessionId: string
  afterSeq?: number | null
}

export interface AttachTerminalResult {
  sessionId: string
  authority: TerminalGeometryAuthority
}

export interface DetachTerminalInput {
  sessionId: string
}

export interface PtySessionNodeBinding {
  sessionId: string
  nodeId: string
}

export interface SnapshotTerminalInput {
  sessionId: string
}

export interface SnapshotTerminalResult {
  data: string
}

export type TerminalBufferKind = 'normal' | 'alternate' | 'unknown'

export interface TerminalCursorPosition {
  x: number
  y: number
}

export interface PresentationSnapshotTerminalInput {
  sessionId: string
}

export interface PresentationSnapshotTerminalResult {
  sessionId: string
  epoch: number
  appliedSeq: number
  presentationRevision: number
  cols: number
  rows: number
  geometryRevision?: number | null
  bufferKind: TerminalBufferKind
  cursor: TerminalCursorPosition
  title: string | null
  serializedScreen: string
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
  seq?: number
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number
}

export type TerminalForegroundEvent =
  import('../../runtime/agentForegroundRecognition').ForegroundAgentReconciliationEvent

export interface TerminalGeometryEvent {
  sessionId: string
  cols: number
  rows: number
  reason: TerminalGeometryCommitReason
  revision?: number | null
}

export interface TerminalResyncEvent {
  sessionId: string
  reason: 'replay_window_exceeded'
  recovery: 'presentation_snapshot'
}

export type TerminalSessionState = 'working' | 'waiting' | 'standby'

export type AgentHookStateSource = 'claude_hook' | 'codex_hook' | 'pi_hook'

export type TerminalSessionStateSource = 'launch' | 'session_file' | AgentHookStateSource

/** Actual telemetry configured for one invocation; never inferred from observations. */
export type AgentHookCoverage = 'lifecycle' | 'notify_only' | 'none' | 'unverified_executable'

/** Runtime provenance, supplied by PTY spawn or the terminal invocation owner. */
export type AgentLaunchKind = 'managed' | 'terminal'

export type AgentHookInstallState =
  | 'installed'
  | 'partial'
  | 'not_installed'
  | 'error'
  | 'skipped'
  | 'not_required'

export interface TerminalSessionStateEvent {
  /** Provider history reconstruction; never a live turn boundary. Consumed by the Worker. */
  baseline?: boolean
  /** Present only on Worker-decided projections. */
  agentRunState?: import('./agentRunState').AgentRunSnapshot
  agentProvider?: AgentProviderId
  remote?: boolean
  remoteAgentRun?: import('./agentRunState').RemoteAgentRunUpdate
  emittedAtMs?: number
  hookEventName?: string
  blockedReason?: 'permission' | 'question' | 'plan' | null

  piConversation?: { pid: number; revision: number }
  observationUnavailable?: boolean
  sessionId: string
  state: TerminalSessionState
  source?: TerminalSessionStateSource
  hookInstallState?: AgentHookInstallState
  degraded?: boolean
  observedAtMs?: number
}

export type TerminalAgentShimProvider = 'claude-code' | 'codex' | 'pi'

export interface TerminalAgentActivitySnapshot {
  provider: TerminalAgentShimProvider
  /** Invocation intent, independent of subsequent provider identity discovery. */
  launchMode?: AgentLaunchMode
  invocationId: string
  generation: number
  phase: 'active' | 'exited'
  observedAtMs: number
  identityAuthority: 'provider_session_start' | 'provider_session_snapshot' | 'session_file' | null
  sourceRevision?: number
  revision?: number
}

export interface TerminalAgentActivityFence {
  provider: TerminalAgentShimProvider
  invocationId: string
  generation: number
  phase: 'active' | 'exited'
  observedAtMs: number
  sourceRevision?: number
  revision?: number
}

export interface TerminalAgentReexecInput {
  sessionId: string
  operationId?: string
  provider: AgentProviderId
  resumeSessionId: string | null
  expectedActivity: TerminalAgentActivityFence | null
  authorityEpoch?: number | null
}

export type TerminalAgentReexecStatus =
  | 'reexecuted'
  | 'drop_back_timeout'
  | 'rejected_not_controller'
  | 'rejected_stale_authority'
  | 'rejected_stale_activity'
  | 'session_not_found'
  | 'runtime_failed'

export interface TerminalAgentReexecResult {
  sessionId: string
  operationId: string
  status: TerminalAgentReexecStatus
}

export interface TerminalSessionMetadataEvent {
  agentLaunchKind?: AgentLaunchKind
  hookCoverage?: AgentHookCoverage
  hookInstallState?: AgentHookInstallState
  remote?: boolean
  /** Validated, launch-scoped native Pi observation; runtime-only, not workspace persistence. */
  piSnapshot?: import('./piAgentSnapshot').PiAgentSnapshot
  sessionId: string
  resumeSessionId: string | null
  agentProvider?: AgentProviderId
  profileId?: string | null
  runtimeKind?: TerminalRuntimeKind
  terminalAgentActivity?: TerminalAgentActivitySnapshot | null
}

export interface TerminalAgentActivityMetadata {
  sessionId: string
  resumeSessionId: string | null
  terminalAgentActivity: TerminalAgentActivitySnapshot
}

export interface ListTerminalAgentActivityMetadataResult {
  entries: TerminalAgentActivityMetadata[]
}
