import { useWorkspaceCanvasPtyTaskCompletion } from './usePtyTaskCompletion'

export function useWorkspaceCanvasRuntimeBindings({
  workspaceId,
  nodes,
  listAgentSessions,
}: {
  workspaceId: string
  nodes: Parameters<typeof useWorkspaceCanvasPtyTaskCompletion>[0]['nodes']
  listAgentSessions: Parameters<typeof useWorkspaceCanvasPtyTaskCompletion>[0]['listAgentSessions']
}): void {
  useWorkspaceCanvasPtyTaskCompletion({
    workspaceId,
    nodes,
    listAgentSessions,
  })
}
