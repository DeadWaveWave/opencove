import type { ManagedClaudeBindingObservation } from '../../../../shared/contracts/managedClaudeLaunch'
import type { CommitManagedClaudeRebindInput } from '../../../../shared/contracts/managedClaudeResumeBinding'
import type { ClaudeQualificationIdentity } from './qualification'
export type Target = { identity: ClaudeQualificationIdentity; mutationId: string }
export type Invocation = {
  nodeId: string
  runtimeSessionId: string
  credential: object
  current: () => boolean
  open: boolean
  valid: boolean
  failed?: boolean
  expired?: boolean
  needsReadback?: boolean
  expiration: number
  epoch: number
  suspensions: Set<symbol>
  highest: number
  committed: ManagedClaudeBindingObservation
  tickets: Set<AbortController>
  target?: Target
  unresolved?: { input: CommitManagedClaudeRebindInput; nodeSeen: boolean }
  busy?: Promise<void>
  cancelRetry?: () => void
}
