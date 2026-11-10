import type { ManagedResumeBindingTuple } from './managedClaudeResumeBinding'

export interface ManagedClaudeLaunchExpected {
  activationId: string | null
  tuple: ManagedResumeBindingTuple
}
export type ManagedClaudeLaunchIntent =
  | { kind: 'resumeCurrent' }
  | { kind: 'resumeConversation'; resumeSessionId: string; expected: ManagedClaudeLaunchExpected }
  | { kind: 'launchNew'; expected: ManagedClaudeLaunchExpected }

export interface ManagedClaudeBindingObservation {
  nodeId: string
  activationId: string
  runtimeSessionId: string | null
  tuple: ManagedResumeBindingTuple
  nodeSeen: boolean
  bindingRevision: number
  observedRevision: number
}
export interface ManagedClaudeLifecycleReceipt {
  binding: ManagedClaudeBindingObservation
  commitRevision: number | null
}
/** Structural execution context, captured and compared for adoption as well as replacement. */
export interface ManagedClaudeNodeContext {
  kind: string
  provider: string | null
  directory: string | null
  route: string
}
export interface ManagedClaudeNodeObservation {
  nodeId: string
  binding: ManagedClaudeBindingObservation | null
  nodeRuntimeSessionId?: string | null
  retired: boolean
  context: ManagedClaudeNodeContext | null
}
export interface AppStateCommittedObservation {
  revision: number
  removedNodeIds: readonly string[]
  removedRuntimeSessionIds: readonly string[]
  removedManagedRuntimeSessionIds: readonly string[]
}
export const ABSENT_MANAGED_CLAUDE_BINDING: ManagedClaudeLaunchExpected = {
  activationId: null,
  tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
}

/** A definitive ledger lookup; a canvas node need not have been persisted yet. */
export interface GetManagedClaudeBindingResult {
  managedClaudeBinding: ManagedClaudeBindingObservation | null
  retired: boolean
  executionDirectory: string | null
}
