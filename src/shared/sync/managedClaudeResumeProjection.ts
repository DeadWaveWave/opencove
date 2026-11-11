import type { ManagedClaudeResumeBindingOwnership } from '../contracts/managedClaudeLaunch'

export function normalizeManagedClaudeResumeBindingOwnership(
  value: unknown,
): ManagedClaudeResumeBindingOwnership | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const marker = value as Record<string, unknown>
  if (
    typeof marker.activationId !== 'string' ||
    !marker.activationId.trim() ||
    !(
      marker.runtimeSessionId === null ||
      (typeof marker.runtimeSessionId === 'string' && !!marker.runtimeSessionId.trim())
    )
  ) {
    return null
  }
  return { activationId: marker.activationId, runtimeSessionId: marker.runtimeSessionId }
}

export interface ManagedClaudeNodeProjection {
  kind?: string
  sessionId?: string | null
  workerBinding?: unknown
  managedClaudeResumeBindingOwnership?: ManagedClaudeResumeBindingOwnership | null
  agent?: unknown
}

/** Canonical owned fields are projected last, independently of three-way merge equality. */
export function projectOwnedManagedClaudeNode<T extends ManagedClaudeNodeProjection>(
  canonical: ManagedClaudeNodeProjection,
  proposed: T,
): T {
  const marker = normalizeManagedClaudeResumeBindingOwnership(
    canonical.managedClaudeResumeBindingOwnership,
  )
  if (!marker) {
    return proposed
  }
  const agent = canonical.agent as Record<string, unknown> | null
  const localAgent = proposed.agent as Record<string, unknown> | null
  return {
    ...proposed,
    kind: canonical.kind,
    workerBinding: canonical.workerBinding,
    managedClaudeResumeBindingOwnership: marker,
    ...(marker.runtimeSessionId !== null ? { sessionId: marker.runtimeSessionId } : {}),
    agent: agent
      ? {
          ...localAgent,
          provider: agent.provider,
          resumeSessionId: agent.resumeSessionId,
          resumeSessionIdVerified: agent.resumeSessionIdVerified,
        }
      : canonical.agent,
  }
}
