import { useWorkspaceCanvasAgentLastMessageCopy } from './useAgentLastMessageToNote'
import { useWorkspaceCanvasSyncActionRefs, type WorkspaceCanvasActionRefs } from './useActionRefs'
import { useWorkspaceCanvasPtyTaskCompletion } from './usePtyTaskCompletion'

export function useWorkspaceCanvasRuntimeBindings({
  workspaceId,
  nodes,
  setNodes,
  actionRefs,
  updateNodeScrollback,
  updateTerminalTitle,
  clearTerminalAgentOverlay,
  renameTerminalTitle,
  reloadAgentSession,
  listAgentSessions,
  switchAgentSession,
  onShowMessage,
}: {
  workspaceId: string
  nodes: Parameters<typeof useWorkspaceCanvasPtyTaskCompletion>[0]['nodes']
  setNodes: Parameters<typeof useWorkspaceCanvasPtyTaskCompletion>[0]['setNodes']
  actionRefs: WorkspaceCanvasActionRefs
  updateNodeScrollback: Parameters<
    typeof useWorkspaceCanvasSyncActionRefs
  >[0]['updateNodeScrollback']
  updateTerminalTitle: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['updateTerminalTitle']
  clearTerminalAgentOverlay: Parameters<
    typeof useWorkspaceCanvasSyncActionRefs
  >[0]['clearTerminalAgentOverlay']
  renameTerminalTitle: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['renameTerminalTitle']
  reloadAgentSession: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['reloadAgentSession']
  listAgentSessions: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['listAgentSessions']
  switchAgentSession: Parameters<typeof useWorkspaceCanvasSyncActionRefs>[0]['switchAgentSession']
  onShowMessage?: Parameters<typeof useWorkspaceCanvasAgentLastMessageCopy>[0]['onShowMessage']
}): void {
  useWorkspaceCanvasPtyTaskCompletion({
    workspaceId,
    nodes,
    setNodes,
    listAgentSessions,
  })

  const copyAgentLastMessage = useWorkspaceCanvasAgentLastMessageCopy({ onShowMessage })

  useWorkspaceCanvasSyncActionRefs({
    actionRefs,
    copyAgentLastMessage,
    reloadAgentSession,
    listAgentSessions,
    switchAgentSession,
    updateNodeScrollback,
    updateTerminalTitle,
    clearTerminalAgentOverlay,
    renameTerminalTitle,
  })
}
