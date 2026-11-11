import type {
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'

export function hasRuntimeBindingPublication(workspaces: WorkspaceState[]): boolean {
  return workspaces.some(workspace =>
    workspace.nodes.some(node => node.data.runtimeSessionBinding?.phase === 'publishing'),
  )
}

/** A prepare result owns its projection until shared state acknowledges that exact binding. */
export function mergeRuntimeSessionBinding(
  persisted: TerminalNodeData,
  existing: TerminalNodeData,
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
      agent: existing.agent,
    }
  }
  return {
    runtimeSessionBinding: undefined,
    sessionId:
      isPublishing && !superseded
        ? binding.sessionId
        : persisted.sessionId.trim() || existing.sessionId.trim(),
  }
}
