import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { useWorkspaceCanvasActionRefs } from './useActionRefs'
import type { useWorkspaceCanvasAgentSupport } from './useCanvasAgentSupport'
import type { useWorkspaceCanvasTaskUi } from './useCanvasTaskUi'
import type { useWorkspaceCanvasNodesStore } from './useNodesStore'
import type { useWorkspaceCanvasState } from './useCanvasState'
import type { useWorkspaceCanvasNodePublishers } from './useCanvasNodePublishers'
import { useWorkspaceCanvasRuntimeBindings } from './useCanvasRuntimeBindings'
import { useWorkspaceCanvasApplyNodeChanges } from './useApplyNodeChanges'

type RuntimeBindings = Parameters<typeof useWorkspaceCanvasRuntimeBindings>[0]
type NodeChanges = Parameters<typeof useWorkspaceCanvasApplyNodeChanges>[0]

export function useWorkspaceCanvasRuntimeIntegrations({
  actionRefs,
  nodeStore,
  taskUi,
  agentSupport,
  agentSettings,
  reactFlow,
  clearNodeSelection,
  onRequestPersistFlush,
  onShowMessage,
  canvasState,
  nodePublishers,
  nodeDragSession,
  exclusiveNodeDragAnchorIdRef,
}: {
  actionRefs: ReturnType<typeof useWorkspaceCanvasActionRefs>
  nodeStore: ReturnType<typeof useWorkspaceCanvasNodesStore>
  taskUi: Pick<ReturnType<typeof useWorkspaceCanvasTaskUi>, 'requestNodeClose'>
  agentSupport: ReturnType<typeof useWorkspaceCanvasAgentSupport>
  agentSettings: AgentSettings
  reactFlow: RuntimeBindings['reactFlow']
  clearNodeSelection: RuntimeBindings['clearNodeSelection']
  onRequestPersistFlush: RuntimeBindings['onRequestPersistFlush']
  onShowMessage: RuntimeBindings['onShowMessage']
  canvasState: ReturnType<typeof useWorkspaceCanvasState>
  nodePublishers: ReturnType<typeof useWorkspaceCanvasNodePublishers>
  nodeDragSession: NodeChanges['nodeDragSession']
  exclusiveNodeDragAnchorIdRef: NodeChanges['exclusiveNodeDragAnchorIdRef']
}) {
  useWorkspaceCanvasRuntimeBindings({
    setNodes: nodeStore.setNodes,
    onRequestPersistFlush,
    actionRefs,
    clearNodeSelection,
    closeNode: taskUi.requestNodeClose,
    resizeNode: nodeStore.resizeNode,
    noteMutations: nodeStore,
    updateWebsiteUrl: nodeStore.updateWebsiteUrl,
    setWebsitePinned: nodeStore.setWebsitePinned,
    setWebsiteSession: nodeStore.setWebsiteSession,
    setWebsiteMode: nodeStore.setWebsiteMode,
    setWebsiteFullscreen: nodeStore.setWebsiteFullscreen,
    updateNodeScrollback: nodeStore.updateNodeScrollback,
    updateTerminalTitle: nodeStore.updateTerminalTitle,
    clearTerminalAgentOverlay: nodeStore.clearTerminalAgentOverlay,
    renameTerminalTitle: nodeStore.renameTerminalTitle,
    reloadAgentSession: agentSupport.reloadAgentNode,
    listAgentSessions: agentSupport.listAgentSessionsForNode,
    switchAgentSession: agentSupport.switchAgentNodeSession,
    focusNodeOnClick: agentSettings.focusNodeOnClick,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    nodesRef: nodeStore.nodesRef,
    reactFlow,
    onShowMessage,
  })
  const applyChanges = useWorkspaceCanvasApplyNodeChanges({
    nodesRef: nodeStore.nodesRef,
    onNodesChange: nodePublishers.publishLiveNodesChange,
    onNodesCommit: nodePublishers.commitNodesChange,
    onSelectedNodeIdsChange: canvasState.syncSelectedNodeIds,
    clearAgentLaunchToken: nodeStore.clearAgentLaunchToken,
    normalizePosition: nodeStore.normalizePosition,
    applyPendingScrollbacks: nodeStore.applyPendingScrollbacks,
    isNodeDraggingRef: nodeStore.isNodeDraggingRef,
    dragSelectedSpaceIdsRef: canvasState.dragSelectedSpaceIdsRef,
    exclusiveNodeDragAnchorIdRef,
    nodeDragSession,
  })
  return applyChanges
}
