import type { useWorkspaceCanvasAgentSupport } from './useCanvasAgentSupport'
import type { useWorkspaceCanvasNodesStore } from './useNodesStore'
import type { useWorkspaceCanvasState } from './useCanvasState'
import type { useWorkspaceCanvasNodePublishers } from './useCanvasNodePublishers'
import { useWorkspaceCanvasRuntimeBindings } from './useCanvasRuntimeBindings'
import { useWorkspaceCanvasApplyNodeChanges } from './useApplyNodeChanges'

type NodeChanges = Parameters<typeof useWorkspaceCanvasApplyNodeChanges>[0]

export function useWorkspaceCanvasRuntimeIntegrations({
  workspaceId,
  nodeStore,
  agentSupport,
  canvasState,
  nodePublishers,
  nodeDragSession,
  exclusiveNodeDragAnchorIdRef,
}: {
  workspaceId: string
  nodeStore: ReturnType<typeof useWorkspaceCanvasNodesStore>
  agentSupport: ReturnType<typeof useWorkspaceCanvasAgentSupport>
  canvasState: ReturnType<typeof useWorkspaceCanvasState>
  nodePublishers: ReturnType<typeof useWorkspaceCanvasNodePublishers>
  nodeDragSession: NodeChanges['nodeDragSession']
  exclusiveNodeDragAnchorIdRef: NodeChanges['exclusiveNodeDragAnchorIdRef']
}) {
  useWorkspaceCanvasRuntimeBindings({
    workspaceId,
    nodes: canvasState.flowNodes,
    listAgentSessions: agentSupport.listAgentSessionsForNode,
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
