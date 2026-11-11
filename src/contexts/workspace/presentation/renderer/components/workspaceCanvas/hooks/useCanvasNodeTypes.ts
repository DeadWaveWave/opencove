import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceCanvasActionRefs } from './useActionRefs'
import { useWorkspaceCanvasSelectNode } from './useSelectNode'
import { useWorkspaceCanvasNodeTypes } from '../nodeTypes'

export function useWorkspaceCanvasComposedNodeTypes({
  nodeStore,
  canvasState,
  workspacePath,
  onShowMessage,
  agentSettings,
  actionRefs,
  convertNoteToTask,
}: {
  nodeStore: Pick<
    import('./useNodesStore.types').UseWorkspaceCanvasNodesStoreResult,
    'setNodes' | 'setNodeLabelColorOverride'
  >
  canvasState: Pick<
    ReturnType<typeof import('./useCanvasState').useWorkspaceCanvasState>,
    | 'setSelectedNodeIds'
    | 'setSelectedSpaceIds'
    | 'selectedNodeIdsRef'
    | 'selectedSpaceIdsRef'
    | 'spacesRef'
  >
  workspacePath: string
  onShowMessage?: Parameters<typeof useWorkspaceCanvasNodeTypes>[0]['onShowMessage']
  agentSettings: AgentSettings
  actionRefs: WorkspaceCanvasActionRefs
  convertNoteToTask: (nodeId: string) => boolean
}) {
  const { setNodes, setNodeLabelColorOverride } = nodeStore
  const {
    setSelectedNodeIds,
    setSelectedSpaceIds,
    selectedNodeIdsRef,
    selectedSpaceIdsRef,
    spacesRef,
  } = canvasState
  const selectNode: (nodeId: string, options?: { toggle?: boolean }) => void =
    useWorkspaceCanvasSelectNode({
      setNodes,
      setSelectedNodeIds,
      setSelectedSpaceIds,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      spacesRef,
    })

  return useWorkspaceCanvasNodeTypes({
    spacesRef,
    workspacePath,
    onShowMessage,
    agentProviderOrder: agentSettings.agentProviderOrder,
    defaultProvider: agentSettings.defaultProvider,
    browserDefaultMode: agentSettings.browserDefaultMode,
    browserSearchEngine: agentSettings.browserSearchEngine,
    selectNode,
    convertNoteToTask,
    setNodeLabelColorOverride,
    ...actionRefs,
  })
}
