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
}): { nextWorkspaces: WorkspaceState[]; didChange: boolean; durableDidChange: boolean } {
  let didChange = false

  const nextWorkspaces = workspaces.map(workspace => {
    let workspaceDidChange = false
    const nextNodes = workspace.nodes.map(node => {
      if (node.data.sessionId !== sessionId) {
        return node
      }

      if (node.data.kind !== 'agent' || !node.data.agent) {
        return node
      }

      const update = resolveObservedResumeSessionBindingUpdate(node.data.agent, resumeSessionId)
      if (!update) {
        return node
      }

      workspaceDidChange = true
      return {
        ...node,
        data: {
          ...node.data,
          agent: { ...node.data.agent, ...update },
        },
      }
    })

    if (!workspaceDidChange) {
      return workspace
    }

    didChange = true
    return { ...workspace, nodes: nextNodes }
  })

  return {
    nextWorkspaces: didChange ? nextWorkspaces : workspaces,
    didChange,
    durableDidChange: didChange,
  }
}
