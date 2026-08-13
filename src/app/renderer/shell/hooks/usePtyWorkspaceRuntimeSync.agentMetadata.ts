import { resolveObservedResumeSessionBindingUpdate } from '@contexts/agent/domain/agentResumeBinding'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'

export function updateWorkspacesWithAgentMetadata({
  workspaces,
  sessionId,
  resumeSessionId,
}: {
  workspaces: WorkspaceState[]
  sessionId: string
  resumeSessionId: string | null | undefined
}): { nextWorkspaces: WorkspaceState[]; didChange: boolean } {
  let didChange = false

  const nextWorkspaces = workspaces.map(workspace => {
    let workspaceDidChange = false
    const nextNodes = workspace.nodes.map(node => {
      if (node.data.sessionId !== sessionId) {
        return node
      }

      const binding = node.data.kind === 'agent' ? node.data.agent : node.data.terminalAgentBinding
      const terminalProvider =
        node.data.kind === 'terminal'
          ? (node.data.terminalAgentBinding?.provider ??
            node.data.agentOverlay?.provider ??
            node.data.terminalProviderHint ??
            null)
          : null
      if (!binding && !terminalProvider) {
        return node
      }

      const update = resolveObservedResumeSessionBindingUpdate(
        binding ?? {
          provider: terminalProvider!,
          resumeSessionId: null,
          resumeSessionIdVerified: false,
        },
        resumeSessionId,
      )
      if (!update) {
        return node
      }

      workspaceDidChange = true
      return {
        ...node,
        data: {
          ...node.data,
          ...(node.data.kind === 'agent'
            ? { agent: { ...node.data.agent!, ...update } }
            : {
                terminalAgentBinding: {
                  provider: terminalProvider!,
                  ...update,
                },
              }),
        },
      }
    })

    if (!workspaceDidChange) {
      return workspace
    }

    didChange = true
    return { ...workspace, nodes: nextNodes }
  })

  return { nextWorkspaces: didChange ? nextWorkspaces : workspaces, didChange }
}
