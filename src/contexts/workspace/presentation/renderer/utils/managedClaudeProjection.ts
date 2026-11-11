import type {
  GetManagedClaudeBindingResult,
  ManagedClaudeBindingObservation,
} from '@shared/contracts/managedClaudeLaunch'
import { canonicalContent } from '@shared/sync/mergeValue'
import type { TerminalNodeData } from '../types'
import { projectOwnedManagedClaudeNode } from '@shared/sync/managedClaudeResumeProjection'
import {
  getAcceptedRevision,
  getSyncedPersistedState,
  isRetiredManagedNode,
  persistenceScope,
} from './persistence/publicationState'
import { requestCanonicalRefresh } from './persistence/canonicalRefresh'
let generation = -1
const observations = new Map<string, ManagedClaudeBindingObservation>()
function currentObservation(nodeId: string): ManagedClaudeBindingObservation | null {
  const scope = persistenceScope()
  if (generation !== scope) {
    observations.clear()
    generation = scope
  }
  const node = getSyncedPersistedState()
    ?.workspaces.flatMap(workspace => workspace.nodes)
    .find(candidate => candidate.id === nodeId)
  const marker = node?.managedClaudeResumeBindingOwnership
  const targeted = observations.get(nodeId)
  if (marker && node?.agent && (getAcceptedRevision() ?? 0) >= (targeted?.observedRevision ?? 0)) {
    return {
      nodeId,
      ...marker,
      tuple: {
        resumeSessionId: node.agent.resumeSessionId ?? null,
        resumeSessionIdVerified: node.agent.resumeSessionIdVerified === true,
      },
      nodeSeen: true,
      bindingRevision: 0,
      observedRevision: getAcceptedRevision() ?? 0,
    }
  }
  return targeted ?? null
}
function bindingContent(binding: ManagedClaudeBindingObservation): string {
  return canonicalContent([binding.activationId, binding.runtimeSessionId, binding.tuple])!
}
export function acceptManagedClaudeObservation(
  nodeId: string,
  observation: ManagedClaudeBindingObservation,
  context: {
    operationIsCurrent: boolean
    nodeStillPresent: boolean
    acceptedSnapshotRevision: number | null
  },
): 'accepted' | 'stale' | 'resync-required' {
  const current = currentObservation(nodeId)
  if (!context.operationIsCurrent || !context.nodeStillPresent || isRetiredManagedNode(nodeId)) {
    return 'stale'
  }
  if (
    observation.nodeId !== nodeId ||
    !Number.isSafeInteger(observation.observedRevision) ||
    observation.observedRevision < 0
  ) {
    requestCanonicalRefresh({ reason: 'uncertain' })
    return 'resync-required'
  }
  if (
    observation.observedRevision <
    Math.max(context.acceptedSnapshotRevision ?? 0, current?.observedRevision ?? 0)
  ) {
    return 'stale'
  }
  if (
    current &&
    current.observedRevision === observation.observedRevision &&
    bindingContent(current) !== bindingContent(observation)
  ) {
    requestCanonicalRefresh({ reason: 'uncertain', minimumRevision: observation.observedRevision })
    return 'resync-required'
  }
  observations.set(nodeId, observation)
  if (observation.nodeSeen && observation.observedRevision > (getAcceptedRevision() ?? 0)) {
    requestCanonicalRefresh({ reason: 'merged', minimumRevision: observation.observedRevision })
  }
  return 'accepted'
}
/** Tuple authority and runtime attachment are intentionally separate decisions. */
export function projectManagedClaudeRuntimeData(
  nodeId: string,
  proposed: TerminalNodeData,
): TerminalNodeData | null {
  if (isRetiredManagedNode(nodeId)) {
    return null
  }
  const incoming = proposed.managedClaudeBindingObservation
  const canonical = currentObservation(nodeId)
  if (!incoming) {
    if (proposed.managedClaudeResumeBindingOwnership) {
      requestCanonicalRefresh({ reason: 'uncertain' })
      return null
    }
    return proposed
  }
  const outcome = acceptManagedClaudeObservation(nodeId, incoming, {
    operationIsCurrent: true,
    nodeStillPresent: true,
    acceptedSnapshotRevision: getAcceptedRevision(),
  })
  const binding = outcome === 'accepted' ? incoming : canonical
  if (!binding || outcome === 'resync-required') {
    return null
  }
  if (binding.runtimeSessionId !== null && binding.runtimeSessionId !== proposed.sessionId) {
    return null
  }
  return projectOwnedManagedClaudeNode(
    {
      kind: 'agent',
      workerBinding: proposed.workerBinding,
      managedClaudeResumeBindingOwnership: {
        activationId: binding.activationId,
        runtimeSessionId: binding.runtimeSessionId,
      },
      agent: { ...proposed.agent, provider: 'claude-code', ...binding.tuple },
    },
    proposed,
  )
}
/** Fresh row-only activations have no app revision; confirm their definitive association. */
export async function confirmManagedClaudeRuntime(
  nodeId: string,
  proposed: TerminalNodeData,
): Promise<TerminalNodeData | null> {
  const observation = proposed.managedClaudeBindingObservation
  const scope = persistenceScope()
  if (observation && !observation.nodeSeen) {
    const result = await window.opencoveApi.controlSurface.invoke<GetManagedClaudeBindingResult>({
      kind: 'query',
      id: 'node.managedClaudeBinding',
      payload: { nodeId },
    })
    if (
      persistenceScope() !== scope ||
      result.retired ||
      !result.managedClaudeBinding ||
      result.managedClaudeBinding.activationId !== observation.activationId ||
      result.managedClaudeBinding.runtimeSessionId !== proposed.sessionId
    ) {
      return null
    }
    observations.set(nodeId, result.managedClaudeBinding)
    proposed = { ...proposed, managedClaudeBindingObservation: result.managedClaudeBinding }
  }
  return persistenceScope() === scope ? projectManagedClaudeRuntimeData(nodeId, proposed) : null
}
