import type { ManagedClaudeLaunchPorts } from './ports'
import type { ActivateManagedClaudeRuntimeInput } from '../../../../shared/contracts/managedClaudeResumeBinding'

/** A publication failure cannot compensate a confirmed activation. */
export function publishManagedClaudeActivation(
  ports: ManagedClaudeLaunchPorts,
  input: ActivateManagedClaudeRuntimeInput,
  revision: number,
  effectiveState: unknown,
): void {
  try {
    ports.publishCommittedActivation({
      nodeId: input.nodeId,
      activationId: input.activationId,
      revision,
      effectiveState,
    })
  } catch {
    /* Already committed. */
  }
}
