import type {
  TaskAuthorityRecord,
  TaskCommandReceipt,
} from '../../../shared/contracts/taskAuthority'

export interface TaskHolderIdentity {
  nodeId: string
  projectId: string
  kind: string
  sessionId: string | null
  workerBinding: string | null
}
export interface TaskMutationTransaction {
  read(nodeId: string): TaskAuthorityRecord | null
  list(): TaskAuthorityRecord[]
  holder(nodeId: string): TaskHolderIdentity | null
  save(record: TaskAuthorityRecord): void
  revision(): number
  advanceRevision(): number
  receipt(
    principal: string,
    operation: string,
    requestId: string,
  ): { fingerprint: string; result: TaskCommandReceipt } | null
  saveReceipt(principal: string, fingerprint: string, result: TaskCommandReceipt): void
}

export interface TaskMutationRepository {
  fingerprint(normalizedCommand: string): string
  transaction<T>(body: (tx: TaskMutationTransaction) => T): T
  committed(receipt: TaskCommandReceipt): void
}
