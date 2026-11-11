/** Internal storage contracts. Possessing a tuple is not authority to activate a node. */
export interface ManagedResumeBindingTuple {
  resumeSessionId: string | null
  resumeSessionIdVerified: boolean
}

export interface ActivateManagedClaudeRuntimeInput {
  nodeId: string
  activationId: string
  runtimeSessionId: string | null
  tuple: ManagedResumeBindingTuple
  /** Internal first-adoption compare image, checked inside the activation transaction. */
  adoptionSnapshot?: string
  expected?: { activationId: string | null; tuple: ManagedResumeBindingTuple }
}

export interface CommitManagedClaudeRebindInput {
  nodeId: string
  runtimeSessionId: string
  activationId: string
  expected: ManagedResumeBindingTuple
  next: ManagedResumeBindingTuple
}

export type ManagedResumeBindingResult =
  | { status: 'committed' | 'alreadyApplied'; revision?: number; effectiveState?: unknown }
  | { status: 'superseded' | 'nodeGone' | 'conflict' }
  | { status: 'retryableFailure'; outcome: 'notCommitted' | 'unknown' }

export interface ManagedClaudeResumeBindingStore {
  activateManagedClaudeRuntime(
    input: ActivateManagedClaudeRuntimeInput,
  ): Promise<ManagedResumeBindingResult>
  commitManagedClaudeRebind(
    input: CommitManagedClaudeRebindInput,
  ): Promise<ManagedResumeBindingResult>
}

export function sameManagedResumeBinding(
  left: ManagedResumeBindingTuple,
  right: ManagedResumeBindingTuple,
): boolean {
  return (
    left.resumeSessionId === right.resumeSessionId &&
    left.resumeSessionIdVerified === right.resumeSessionIdVerified
  )
}
