import { useWorkspaceCanvasTaskActions } from './useTaskActions'
import { useWorkspaceCanvasTaskTagOptions } from './useTaskTagOptions'

type TaskActionsParams = Parameters<typeof useWorkspaceCanvasTaskActions>[0]

export function useWorkspaceCanvasTaskSupport({
  agentTaskTagOptions,
  readAgentSettings,
  readTerminalDisplayCalibration,
  createNodeForSession,
  buildAgentNodeTitle,
  launchAgentInNode,
  workspaceId,
  workspacePath,
  environmentVariables,
}: {
  agentTaskTagOptions: Parameters<typeof useWorkspaceCanvasTaskTagOptions>[0]
  readAgentSettings: TaskActionsParams['readAgentSettings']
  readTerminalDisplayCalibration: TaskActionsParams['readTerminalDisplayCalibration']
  createNodeForSession: TaskActionsParams['createNodeForSession']
  buildAgentNodeTitle: TaskActionsParams['buildAgentNodeTitle']
  launchAgentInNode: TaskActionsParams['launchAgentInNode']
  workspaceId: TaskActionsParams['workspaceId']
  workspacePath: TaskActionsParams['workspacePath']
  environmentVariables?: Record<string, string>
}): { taskTagOptions: string[] } & ReturnType<typeof useWorkspaceCanvasTaskActions> {
  const taskTagOptions = useWorkspaceCanvasTaskTagOptions(agentTaskTagOptions)
  const taskActions = useWorkspaceCanvasTaskActions({
    readAgentSettings,
    readTerminalDisplayCalibration,
    createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    workspaceId,
    workspacePath,
    environmentVariables,
    taskTagOptions,
  })

  return { taskTagOptions, ...taskActions }
}
