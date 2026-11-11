/** Deliberately stale wire data: never rely on a captured snapshot still being stale later. */
export function staleManagedPublication(snapshot: unknown, nodeId: string, x: number) {
  const candidate = structuredClone(snapshot) as {
    workspaces: Array<{
      nodes: Array<{
        id: string
        kind: string
        position: { x: number; y: number }
        agent: {
          provider: string
          resumeSessionId: string | null
          resumeSessionIdVerified: boolean
        } | null
        managedClaudeResumeBindingOwnership?: { activationId: string }
      }>
    }>
  }
  const node = candidate.workspaces
    .flatMap(workspace => workspace.nodes)
    .find(entry => entry.id === nodeId)
  if (
    node?.kind !== 'agent' ||
    node.agent?.provider !== 'claude-code' ||
    !node.managedClaudeResumeBindingOwnership
  ) {
    throw new Error(
      'Expected a canonical owned Claude node before constructing the stale publication.',
    )
  }
  const canonicalTuple = {
    resumeSessionId: node.agent.resumeSessionId,
    resumeSessionIdVerified: node.agent.resumeSessionIdVerified,
  }
  node.position = { x, y: 500 }
  node.agent.resumeSessionId =
    'uncommitted-convergence-' + (canonicalTuple.resumeSessionId ?? 'none')
  node.agent.resumeSessionIdVerified = !canonicalTuple.resumeSessionIdVerified
  return {
    candidate,
    canonicalTuple,
    submittedTuple: {
      resumeSessionId: node.agent.resumeSessionId,
      resumeSessionIdVerified: node.agent.resumeSessionIdVerified,
    },
    activationId: node.managedClaudeResumeBindingOwnership.activationId,
  }
}
