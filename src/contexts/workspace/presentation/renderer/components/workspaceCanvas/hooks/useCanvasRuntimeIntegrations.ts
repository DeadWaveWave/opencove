import type { useWorkspaceCanvasActionRefs } from './useActionRefs'
import type { useWorkspaceCanvasAgentSupport } from './useCanvasAgentSupport'
import type { useWorkspaceCanvasNodesStore } from './useNodesStore'
import type { useWorkspaceCanvasState } from './useCanvasState'
import type { useWorkspaceCanvasNodePublishers } from './useCanvasNodePublishers'
import { useWorkspaceCanvasRuntimeBindings } from './useCanvasRuntimeBindings'
import { useWorkspaceCanvasApplyNodeChanges } from './useApplyNodeChanges'

type RuntimeBindings = Parameters<typeof useWorkspaceCanvasRuntimeBindings>[0]
type NodeChanges = Parameters<typeof useWorkspaceCanvasApplyNodeChanges>[0]

export function useWorkspaceCanvasRuntimeIntegrations({
  workspaceId,
  actionRefs,
  nodeStore,
  agentSupport,
  onShowMessage,
  canvasState,
  nodePublishers,
  nodeDragSession,
  exclusiveNodeDragAnchorIdRef,
}: {
  workspaceId: string
  actionRefs: ReturnType<typeof useWorkspaceCanvasActionRefs>
  nodeStore: ReturnType<typeof useWorkspaceCanvasNodesStore>
  agentSupport: ReturnType<typeof useWorkspaceCanvasAgentSupport>
  onShowMessage: RuntimeBindings['onShowMessage']
  canvasState: ReturnType<typeof useWorkspaceCanvasState>
  nodePublishers: ReturnType<typeof useWorkspaceCanvasNodePublishers>
  nodeDragSession: NodeChanges['nodeDragSession']
  exclusiveNodeDragAnchorIdRef: NodeChanges['exclusiveNodeDragAnchorIdRef']
}) {
  useWorkspaceCanvasRuntimeBindings({
    workspaceId,
    nodes: canvasState.flowNodes,
    setNodes: nodeStore.setNodes,
    actionRefs,
    updateNodeScrollback: nodeStore.updateNodeScrollback,
    updateTerminalTitle: nodeStore.updateTerminalTitle,
    clearTerminalAgentOverlay: nodeStore.clearTerminalAgentOverlay,
    renameTerminalTitle: nodeStore.renameTerminalTitle,
    reloadAgentSession: agentSupport.reloadAgentNode,
    listAgentSessions: agentSupport.listAgentSessionsForNode,
    switchAgentSession: agentSupport.switchAgentNodeSession,
    onShowMessage,
  })
  const applyChanges = useWorkspaceCanvasApplyNodeChanges({
    onNodesChange: nodePublishers.publishLiveNodesChange,
    onNodesCommit: nodePublishers.commitNodesChange,
    onNodesRelease: nodePublishers.commitNodesRelease,
    onSelectedNodeIdsChange: canvasState.syncSelectedNodeIds,
    clearAgentLaunchToken: nodeStore.clearAgentLaunchToken,
    normalizePosition: nodeStore.normalizePosition,
    applyPendingScrollbacks: nodeStore.applyPendingScrollbacks,
    nodes: canvasState.flowNodes,
    isNodeDraggingRef: nodeStore.isNodeDraggingRef,
    exclusiveNodeDragAnchorIdRef,
    nodeDragSession,
  })
  return applyChanges
}
