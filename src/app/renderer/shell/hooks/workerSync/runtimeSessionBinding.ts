import type {
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'

export function hasRuntimeBindingPublication(workspaces: WorkspaceState[]): boolean {
  return workspaces.some(workspace =>
    workspace.nodes.some(node => node.data.runtimeSessionBinding?.phase === 'publishing'),
  )
}

/** Keep actual binding fields over rebased task ownership, prompts and launch preferences. */
function mergeAgentRuntimeBinding(
  rebased: TerminalNodeData['agent'],
  existing: TerminalNodeData['agent'],
): TerminalNodeData['agent'] {
  if (!rebased || !existing) {
    return rebased
  }
  return {
    ...rebased,
    effectiveModel: existing.effectiveModel,
    launchMode: existing.launchMode,
    resumeSessionId: existing.resumeSessionId,
    resumeSessionIdVerified: existing.resumeSessionIdVerified,
    executionDirectory: existing.executionDirectory,
    expectedDirectory: existing.expectedDirectory,
  }
}

/** Visible IDs are deliberately empty during background preparation. */
export function resolvedRuntimeSessionId(data: TerminalNodeData): string {
  return data.sessionId.trim() || (data.runtimeSessionBinding?.sessionId?.trim() ?? '')
}

/** A prepare result owns its projection until shared state acknowledges that exact binding. */
export function mergeRuntimeSessionBinding(
  persisted: TerminalNodeData,
  existing: TerminalNodeData,
  options: { preserveUnacknowledgedAgentBinding?: boolean } = {},
): Partial<TerminalNodeData> {
  const binding = existing.runtimeSessionBinding
  const isPreparing = binding?.phase === 'preparing'
  const isPublishing = binding?.phase === 'publishing' && binding.sessionId === existing.sessionId
  const ownedRuntime = persisted.managedClaudeResumeBindingOwnership?.runtimeSessionId
  const associatedRuntime =
    ownedRuntime ?? (persisted.managedClaudeResumeBindingOwnership ? persisted.sessionId : null)
  const superseded =
    !!associatedRuntime &&
    associatedRuntime !== (isPreparing ? binding.sessionId : existing.sessionId)
  if (!superseded && (isPreparing || (isPublishing && persisted.sessionId !== binding.sessionId))) {
    return {
      runtimeSessionBinding: binding,
      sessionId: existing.sessionId,
      isLiveSessionReattach: existing.isLiveSessionReattach,
      kind: existing.kind,
      profileId: existing.profileId,
      runtimeKind: existing.runtimeKind,
      terminalGeometry: existing.terminalGeometry,
      workerBinding: existing.workerBinding,
      status: existing.status,
      startedAt: existing.startedAt,
      endedAt: existing.endedAt,
      exitCode: existing.exitCode,
      lastError: existing.lastError,
      recoveryIssue: existing.recoveryIssue,
      agent: mergeAgentRuntimeBinding(persisted.agent, existing.agent),
    }
  }
  return {
    agent:
      !superseded && options.preserveUnacknowledgedAgentBinding
        ? mergeAgentRuntimeBinding(persisted.agent, existing.agent)
        : persisted.agent,
    runtimeSessionBinding: undefined,
    sessionId:
      isPublishing && !superseded
        ? binding.sessionId
        : persisted.sessionId.trim() || existing.sessionId.trim(),
  }
}
