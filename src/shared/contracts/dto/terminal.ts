export interface PseudoTerminalSession {
  sessionId: string
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

export interface WriteTerminalInput {
  sessionId: string
  data: string
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
