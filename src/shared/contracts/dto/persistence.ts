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
      revision?: number
    }
  | {
      ok: false
      reason: PersistWriteFailureReason
      error: AppErrorDescriptor
    }

export interface WriteWorkspaceStateRawInput {
  raw: string
}

export type PersistenceRecoveryReason = 'corrupt_db' | 'migration_failed'

export interface ReadAppStateResult {
  state: unknown | null
  recovery: PersistenceRecoveryReason | null
}

export interface WriteAppStateInput {
  state: unknown
}

export interface ReadNodeScrollbackInput {
  nodeId: string
}

export interface WriteNodeScrollbackInput {
  nodeId: string
  scrollback: string | null
}
