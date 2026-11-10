import { areNodeWorkerBindingsEqual, normalizeNodeWorkerBinding } from '../types/nodeWorkerBinding'

export type OwnedNodeIdentityField = 'agent' | 'agent.provider' | 'kind' | 'workerBinding'

/** Compare structure only; ledger presence, never incoming fields, grants ownership. */
export function managedClaudeIdentityConflict(
  incoming: { kind: string; agent: unknown; workerBinding?: unknown },
  stored?: { workerBinding?: unknown },
): OwnedNodeIdentityField | null {
  if (!incoming.agent || typeof incoming.agent !== 'object' || Array.isArray(incoming.agent)) {
    return 'agent'
  }
  if ((incoming.agent as Record<string, unknown>).provider !== 'claude-code') {
    return 'agent.provider'
  }
  if (incoming.kind !== 'agent') {
    return 'kind'
  }
  if (stored) {
    // A missing binding inherits the Space route; explicit local never does.
    const left = normalizeNodeWorkerBinding(incoming.workerBinding)
    const right = normalizeNodeWorkerBinding(stored.workerBinding)
    if (!areNodeWorkerBindingsEqual(left, right)) {
      return 'workerBinding'
    }
  }
  return null
}
