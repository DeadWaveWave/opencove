import type { WorkspaceCanvasViewProps } from '../WorkspaceCanvasView.types'
import type { WorkspaceCanvasProps } from '../types'
import type { useWorkspaceCanvasAgentSupport } from './useCanvasAgentSupport'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
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
> & {
  /** The role family's `run` (S7 of #647): the canvas composes it into its commands, not the view. */
  runRole: (nodeId: string, inputOverride?: string) => Promise<void>
}

export function useWorkspaceCanvasRoleUi({
  workspaceId,
  workspacePath,
  environmentVariables,
  agentSettings,
  readAgentSettings,
  nodeStore,
  agentSupport,
  onShowMessage,
}: {
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  agentSettings: WorkspaceCanvasProps['agentSettings']
  readAgentSettings: WorkspaceCanvasProps['readAgentSettings']
  nodeStore: Pick<
    UseWorkspaceCanvasNodesStoreResult,
    'createRoleNode' | 'createNodeForSession' | 'updateRoleInput' | 'appendRoleRunRecord'
  >
  agentSupport: Pick<ReturnType<typeof useWorkspaceCanvasAgentSupport>, 'buildAgentNodeTitle'>
  onShowMessage?: WorkspaceCanvasProps['onShowMessage']
}): RoleViewProps {
  const readDocument = useReadCanvasDocument()
  const roleActions = useWorkspaceCanvasRoleActions({
    workspaceId,
    workspacePath,
    environmentVariables,
    agentSettings,
    readAgentSettings,
    readDocument,
    onShowMessage,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    createRoleNode: nodeStore.createRoleNode,
    createNodeForSession: nodeStore.createNodeForSession,
    updateRoleInput: nodeStore.updateRoleInput,
    appendRoleRunRecord: nodeStore.appendRoleRunRecord,
    buildAgentNodeTitle: agentSupport.buildAgentNodeTitle,
  })

  return {
    runRole: roleActions.runRole,
    openRoleCreator: roleActions.openRoleCreator,
    projectRoles: agentSettings.projectRolesByWorkspaceId[workspaceId] ?? [],
    runProjectRoleFromContextMenu: roleActions.runProjectRoleFromContextMenu,
    openRoleEditor: roleActions.openRoleEditor,
    deleteProjectRole: roleActions.deleteProjectRole,
    closeRoleCreator: roleActions.closeRoleCreator,
    createRole: roleActions.createRole,
  }
}
