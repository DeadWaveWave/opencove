import type { WorkspaceCanvasViewProps } from '../WorkspaceCanvasView.types'
import type { WorkspaceCanvasProps } from '../types'
import type { useWorkspaceCanvasAgentSupport } from './useCanvasAgentSupport'
import type { useWorkspaceCanvasState } from './useCanvasState'
import type { WorkspaceCanvasActionRefs } from './useActionRefs'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { useWorkspaceCanvasRoleActions } from './useRoleActions'

type RoleViewProps = Pick<
  WorkspaceCanvasViewProps,
  | 'openRoleCreator'
  | 'projectRoles'
  | 'runProjectRoleFromContextMenu'
  | 'openRoleEditor'
  | 'deleteProjectRole'
  | 'closeRoleCreator'
  | 'createRole'
>

export function useWorkspaceCanvasRoleUi({
  workspaceId,
  workspacePath,
  environmentVariables,
  agentSettings,
  canvasState,
  nodeStore,
  agentSupport,
  onRequestPersistFlush,
  onShowMessage,
  actionRefs,
}: {
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  agentSettings: WorkspaceCanvasProps['agentSettings']
  canvasState: Pick<ReturnType<typeof useWorkspaceCanvasState>, 'spacesRef'>
  nodeStore: Pick<
    UseWorkspaceCanvasNodesStoreResult,
    | 'nodesRef'
    | 'setNodes'
    | 'updateCanvasDocument'
    | 'createRoleNode'
    | 'createNodeForSession'
    | 'updateRoleProvider'
    | 'updateRoleInput'
    | 'appendRoleRunRecord'
  >
  agentSupport: Pick<ReturnType<typeof useWorkspaceCanvasAgentSupport>, 'buildAgentNodeTitle'>
  onRequestPersistFlush?: WorkspaceCanvasProps['onRequestPersistFlush']
  onShowMessage?: WorkspaceCanvasProps['onShowMessage']
  actionRefs: WorkspaceCanvasActionRefs
}): RoleViewProps {
  const roleActions = useWorkspaceCanvasRoleActions({
    workspaceId,
    workspacePath,
    environmentVariables,
    agentSettings,
    nodesRef: nodeStore.nodesRef,
    spacesRef: canvasState.spacesRef,
    setNodes: nodeStore.setNodes,
    updateCanvasDocument: nodeStore.updateCanvasDocument,
    onRequestPersistFlush,
    onShowMessage,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    createRoleNode: nodeStore.createRoleNode,
    createNodeForSession: nodeStore.createNodeForSession,
    updateRoleProvider: nodeStore.updateRoleProvider,
    updateRoleInput: nodeStore.updateRoleInput,
    appendRoleRunRecord: nodeStore.appendRoleRunRecord,
    actionRefs,
    buildAgentNodeTitle: agentSupport.buildAgentNodeTitle,
  })

  return {
    openRoleCreator: roleActions.openRoleCreator,
    projectRoles: agentSettings.projectRolesByWorkspaceId[workspaceId] ?? [],
    runProjectRoleFromContextMenu: roleActions.runProjectRoleFromContextMenu,
    openRoleEditor: roleActions.openRoleEditor,
    deleteProjectRole: roleActions.deleteProjectRole,
    closeRoleCreator: roleActions.closeRoleCreator,
    createRole: roleActions.createRole,
  }
}
