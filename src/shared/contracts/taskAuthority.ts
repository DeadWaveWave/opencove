import type {
  PersistedTaskAgentSessionRecord,
  PersistedTaskRuntimeStatus,
} from './persistedAppState'

/** Non-expiring coordination, distinct from runtime liveness or authentication. */
export interface TaskClaim {
  holderNodeId: string
  leaseId: string
  acquiredAt: string
}

export interface TaskAuthorityRecord {
  nodeId: string
  projectId: string
  kind: 'task' | 'note'
  generation: string
  version: number
  retired: boolean
  status: PersistedTaskRuntimeStatus
  linkedAgentNodeId: string | null
  claim: TaskClaim | null
  claimNote: string | null
  claimGeneration: number
  lastRunAt: string | null
  agentSessions: PersistedTaskAgentSessionRecord[]
  text: string
  textVersion: number
  legacyConflict: {
    holderNodeId: string
    taskNodeIds: string[]
    reason: 'duplicate_holder' | 'unverified_holder'
  } | null
}

export interface TaskAuthorityMarker {
  generation: string
  version: number
  textVersion: number
}

/** A stable authenticated identity, never a bearer token, cookie or transient grant ID. */
export type TaskPrincipal =
  | { kind: 'session'; nodeId: string; sessionId: string; projectId: string }
  | { kind: 'human'; identityId: string }
  | { kind: 'bearer'; identityId: string }

interface TaskCommandBase {
  requestId: string
  nodeId: string
  expectedAuthorityGeneration: string
}
export type TaskAuthorityCommand = TaskCommandBase &
  (
    | { operation: 'task.claim'; holderNodeId: string; note: string | null }
    | { operation: 'task.release'; leaseId: string }
    | {
        operation: 'task.status'
        status: PersistedTaskRuntimeStatus
        expectedVersion: number
        leaseId: string | null
      }
    | { operation: 'task.note.append'; text: string }
    | { operation: 'task.note.replace'; text: string; expectedTextVersion: number }
    | { operation: 'task.conflict.resolve'; expectedVersion: number }
    | { operation: 'task.retire'; expectedVersion: number }
  )

/** Compact historical evidence; never a fresh canonical snapshot or a growing text copy. */
export interface TaskCommandReceipt {
  requestId: string
  operation: TaskAuthorityCommand['operation']
  nodeId: string
  authorityGeneration: string
  revision: number
  changed: boolean
  replayed: boolean
  version: number
  textVersion: number
  lease: TaskClaim | null
  claimNote: string | null
  appendedBytes?: number
  totalBytes: number
}
