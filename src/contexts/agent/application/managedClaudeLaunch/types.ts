import type {
  ManagedClaudeLaunchExpected,
  ManagedClaudeNodeContext,
} from '../../../../shared/contracts/managedClaudeLaunch'
import type { ManagedResumeBindingTuple } from '../../../../shared/contracts/managedClaudeResumeBinding'

export interface ManagedClaudeLaunchAttempt {
  readonly nodeId: string
  readonly token: symbol
  expected?: ManagedClaudeLaunchExpected
  context?: ManagedClaudeNodeContext | null
  adoptionSnapshot?: string
  /** Cold recovery only; explicit user relaunch may start a stopped node. */
  requireRecoverable?: boolean
}
export interface ManagedClaudeRuntimeCandidate {
  runtimeSessionId: string | null
  tuple: ManagedResumeBindingTuple
}
