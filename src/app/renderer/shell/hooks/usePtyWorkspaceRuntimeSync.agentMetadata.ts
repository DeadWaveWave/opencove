import { resolveAgentMetadataResumeBindingUpdate } from '@contexts/agent/domain/agentResumeBinding'
import type { PiAgentSnapshot } from '@shared/contracts/dto/piAgentSnapshot'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'

export function updateWorkspacesWithAgentMetadata({
  workspaces,
  sessionId,
  resumeSessionId,
  piSnapshot,
}: {
  workspaces: WorkspaceState[]
  sessionId: string
  resumeSessionId: string | null | undefined
  piSnapshot?: PiAgentSnapshot
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

      const update = resolveAgentMetadataResumeBindingUpdate(node.data.agent, {
        resumeSessionId: resumeSessionId ?? null,
        piSnapshot,
      })
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
