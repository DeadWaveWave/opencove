/** Private process-local authority. No DTO or serialized value can mint an admission. */
export interface ManagedClaudeBindingAdmission {
  readonly identity: symbol
}
export interface ClaudeQualificationIdentity {
  readonly occurrenceId: string
  readonly ordinal: number
  readonly resumeSessionId: string
  readonly checkpointId?: string
  readonly promptId: string
}
export interface ClaudeResumeProof extends ClaudeQualificationIdentity {
  readonly evidenceId: string
}
export type QualificationDisposition = {
  status: 'accepted' | 'superseded' | 'cancelled' | 'rejected'
}
export interface ManagedClaudeQualificationTicket {
  readonly signal: AbortSignal
  submit(proof: ClaudeResumeProof): Promise<QualificationDisposition>
  discard(): void
}
export type ManagedClaudeDrainResult =
  | { status: 'drained' }
  | { status: 'degraded'; pendingNodeIds: readonly string[] }
