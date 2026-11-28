import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { useWorkspaceCanvasSpaceExplorer } from './useSpaceExplorer'
import type { WorkspaceCanvasSpaceExplorerArgs } from './useSpaceExplorer.types'
import type { useWorkspaceCanvasState } from './useCanvasState'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

type Params = Pick<
  WorkspaceCanvasSpaceExplorerArgs,
  | 'workspaceId'
  | 'expandNode'
  | 'spaces'
  | 'reactFlow'
  | 'nodeDragSession'
  | 'finalizeDraggedNodeDrop'
> & {
  canvasState: ReturnType<typeof useWorkspaceCanvasState>
  nodeStore: UseWorkspaceCanvasNodesStoreResult
  agentSettings: AgentSettings
}

export function useCanvasSpaceExplorer({
  canvasState,
  nodeStore,
  agentSettings,
  ...params
}: Params) {
  return useWorkspaceCanvasSpaceExplorer({
    ...params,
    canvasRef: canvasState.canvasRef,
    createDocumentNode: nodeStore.createDocumentNode,
    createImageNode: nodeStore.createImageNode,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
  })
}
