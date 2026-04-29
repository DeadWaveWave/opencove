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
  mountId: string
  cwdUri?: string | null
  profileId?: string | null
  shell?: string | null
  command?: string | null
  args?: string[] | null
  cols?: number | null
  rows?: number | null
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
}

export interface ResizeTerminalInput {
  sessionId: string
  cols: number
  rows: number
  reason: TerminalGeometryCommitReason
}

export interface KillTerminalInput {
  sessionId: string
}

export interface AttachTerminalInput {
  sessionId: string
  afterSeq?: number | null
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

export interface TerminalGeometryEvent {
  sessionId: string
  cols: number
  rows: number
  reason: TerminalGeometryCommitReason
}

export interface TerminalResyncEvent {
  sessionId: string
  reason: 'replay_window_exceeded'
  recovery: 'presentation_snapshot'
}

export type TerminalSessionState = 'working' | 'standby'

export interface TerminalSessionStateEvent {
  sessionId: string
  state: TerminalSessionState
}

export interface TerminalSessionMetadataEvent {
  sessionId: string
  resumeSessionId: string | null
  profileId?: string | null
  runtimeKind?: TerminalRuntimeKind
}
