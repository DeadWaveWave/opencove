import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceCanvasActionRefs } from './useActionRefs'
import { useWorkspaceCanvasSelectNode } from './useSelectNode'
import { useWorkspaceCanvasNodeTypes } from '../nodeTypes'

export function useWorkspaceCanvasComposedNodeTypes({
  nodeStore,
  workspacePath,
  onShowMessage,
  agentSettings,
  actionRefs,
  convertNoteToTask,
}: {
  nodeStore: Pick<
    import('./useNodesStore.types').UseWorkspaceCanvasNodesStoreResult,
    'setNodeLabelColorOverride'
  >
  workspacePath: string
  onShowMessage?: Parameters<typeof useWorkspaceCanvasNodeTypes>[0]['onShowMessage']
  agentSettings: AgentSettings
  actionRefs: WorkspaceCanvasActionRefs
  convertNoteToTask: (nodeId: string) => boolean
}) {
  const { setNodeLabelColorOverride } = nodeStore
  const selectNode = useWorkspaceCanvasSelectNode()

  return useWorkspaceCanvasNodeTypes({
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
