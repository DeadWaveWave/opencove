import type { WorkspaceCanvasViewProps } from '../WorkspaceCanvasView.types'
import type { WorkspaceCanvasProps } from '../types'
import type { useWorkspaceCanvasAgentSupport } from './useCanvasAgentSupport'
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
  nodeStore,
  agentSupport,
  onShowMessage,
  actionRefs,
}: {
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  agentSettings: WorkspaceCanvasProps['agentSettings']
  nodeStore: Pick<
    UseWorkspaceCanvasNodesStoreResult,
    | 'setNodes'
    | 'updateCanvasDocument'
    | 'createRoleNode'
    | 'createNodeForSession'
    | 'updateRoleProvider'
    | 'updateRoleInput'
    | 'appendRoleRunRecord'
  >
  agentSupport: Pick<ReturnType<typeof useWorkspaceCanvasAgentSupport>, 'buildAgentNodeTitle'>
  onShowMessage?: WorkspaceCanvasProps['onShowMessage']
  actionRefs: WorkspaceCanvasActionRefs
}): RoleViewProps {
  const roleActions = useWorkspaceCanvasRoleActions({
    workspaceId,
    workspacePath,
    environmentVariables,
    agentSettings,
    setNodes: nodeStore.setNodes,
    updateCanvasDocument: nodeStore.updateCanvasDocument,
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
