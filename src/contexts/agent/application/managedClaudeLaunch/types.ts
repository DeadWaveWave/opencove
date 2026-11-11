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
}
export interface ManagedClaudeRuntimeCandidate {
  runtimeSessionId: string | null
  tuple: ManagedResumeBindingTuple
}
