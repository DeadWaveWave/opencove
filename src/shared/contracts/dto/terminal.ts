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
  cols: number
  rows: number
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

export interface ResizeTerminalInput {
  sessionId: string
  cols: number
  rows: number
}

export interface KillTerminalInput {
  sessionId: string
}

export interface AttachTerminalInput {
  sessionId: string
}

export interface DetachTerminalInput {
  sessionId: string
}

export interface PtySessionNodeBinding {
  sessionId: string
  nodeId: string
}

export interface SyncPtySessionBindingsInput {
  bindings: PtySessionNodeBinding[]
}

export interface SnapshotTerminalInput {
  sessionId: string
}

export interface SnapshotTerminalResult {
  data: string
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number
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
