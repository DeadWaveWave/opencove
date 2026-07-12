import type {
  TerminalPresentationCheckpoint,
  TerminalPresentationSnapshot,
  TerminalRecoveryMutationResult,
  TerminalRecoveryRecord,
  TerminalRuntimeBinding,
} from '../../domain/recovery/terminalRecovery'

export type ReserveTerminalRecoveryInput = {
  nodeId: string
  generation: number
  now: string
}

export type BindTerminalRecoveryInput = ReserveTerminalRecoveryInput & {
  binding: TerminalRuntimeBinding
}

export type CommitTerminalRecoveryInput = BindTerminalRecoveryInput & {
  checkpoint: TerminalPresentationCheckpoint
  rawTail: string
  rawTruncated: boolean
  checksum: string | null
}

export interface TerminalRecoveryPersistencePort {
  read(nodeId: string): Promise<TerminalRecoveryRecord | null>
  reserve(input: ReserveTerminalRecoveryInput): Promise<TerminalRecoveryMutationResult>
  bind(input: BindTerminalRecoveryInput): Promise<TerminalRecoveryMutationResult>
  commit(input: CommitTerminalRecoveryInput): Promise<TerminalRecoveryMutationResult>
}

export interface TerminalRecoveryPresentationPort {
  /**
   * Invoke captureMutationBoundary synchronously at the exact presentation operation boundary,
   * after any transition wait and before snapshot capture yields. Later mutations belong to the
   * next checkpoint.
   */
  snapshotSession(
    sessionId: string,
    captureMutationBoundary: () => void,
  ): Promise<TerminalPresentationSnapshot>
}
