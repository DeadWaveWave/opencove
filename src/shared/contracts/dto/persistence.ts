import type { AppErrorDescriptor } from './error'

export type PersistWriteLevel = 'full' | 'no_scrollback' | 'settings_only'

export type PersistWriteFailureReason =
  | 'unavailable'
  | 'quota'
  | 'payload_too_large'
  | 'io'
  | 'unknown'

export type PersistWriteResult =
  | {
      ok: true
      level: PersistWriteLevel
      bytes: number
      uncertain?: true
      corrected?: boolean
      merged?: true
      revision?: number
    }
  | {
      ok: false
      outcome?: 'unknown' | 'rejected' | 'notSubmitted'
      reason: PersistWriteFailureReason
      error: AppErrorDescriptor
    }

export interface WriteWorkspaceStateRawInput {
  raw: string
}

export type PersistenceRecoveryReason = 'corrupt_db' | 'migration_failed'

export interface ReadAppStateResult {
  revision: number | null
  state: unknown | null
  recovery: PersistenceRecoveryReason | null
}

export interface WriteAppStateInput {
  baseRevision?: number | null
  state: unknown
  allowEmptyWorkspaceOverwrite?: boolean | null
}

export interface ReadNodeScrollbackInput {
  nodeId: string
}

export interface WriteNodeScrollbackInput {
  nodeId: string
  scrollback: string | null
}

export interface ReadAgentNodePlaceholderScrollbackInput {
  nodeId: string
}

export interface WriteAgentNodePlaceholderScrollbackInput {
  nodeId: string
  scrollback: string | null
}
