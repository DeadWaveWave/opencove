import type { ManagedClaudeNodeObservation } from '../../../../shared/contracts/managedClaudeLaunch'
import type { ManagedClaudeResumeBindingStore } from '../../../../shared/contracts/managedClaudeResumeBinding'

export interface ManagedClaudeLaunchPorts extends Pick<
  ManagedClaudeResumeBindingStore,
  'activateManagedClaudeRuntime'
> {
  /** Must throw if a definitive, committed observation is unavailable. */
  observeNode(nodeId: string): ManagedClaudeNodeObservation
  isRuntimeReferenced(runtimeSessionId: string): boolean
  killExactRuntime(runtimeSessionId: string): Promise<void>
  createId(): string
  scheduleReconciliation?: (callback: () => void, delayMs: number) => () => void
  publishCommittedActivation(input: {
    nodeId: string
    activationId: string
    revision: number
    effectiveState: unknown
  }): void
}
