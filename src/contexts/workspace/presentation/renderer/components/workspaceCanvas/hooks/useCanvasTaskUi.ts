import { useWorkspaceCanvasTaskSupport } from './useCanvasTaskSupport'
import { useWorkspaceCanvasTaskWindows } from './useCanvasTaskWindows'

type TaskSupportParams = Parameters<typeof useWorkspaceCanvasTaskSupport>[0]
type TaskWindowsParams = Parameters<typeof useWorkspaceCanvasTaskWindows>[0]

/**
 * The task side of the canvas: the actions, the editor and the creation of task windows. The task
 * family's commands come out of it (`runTaskAgent`, `openTaskEditor` and the rest); the canvas
 * composes them into its command object (S7 of #647).
 */
export function useWorkspaceCanvasTaskUi({
  agentTaskTagOptions,
  readAgentSettings,
  readTerminalDisplayCalibration,
  createNodeForSession,
  buildAgentNodeTitle,
  launchAgentInNode,
  workspaceId,
  workspacePath,
  environmentVariables,
  standardWindowSizeBucket,
  createTaskNode,
  closeNode,
}: {
  agentTaskTagOptions: TaskSupportParams['agentTaskTagOptions']
  readAgentSettings: TaskSupportParams['readAgentSettings']
  readTerminalDisplayCalibration: TaskSupportParams['readTerminalDisplayCalibration']
  createNodeForSession: TaskSupportParams['createNodeForSession']
  buildAgentNodeTitle: TaskSupportParams['buildAgentNodeTitle']
  launchAgentInNode: TaskSupportParams['launchAgentInNode']
  workspaceId: TaskSupportParams['workspaceId']
  workspacePath: TaskSupportParams['workspacePath']
  environmentVariables?: Record<string, string>
  standardWindowSizeBucket: TaskWindowsParams['standardWindowSizeBucket']
  createTaskNode: TaskWindowsParams['createTaskNode']
  closeNode: TaskWindowsParams['closeNode']
}): ReturnType<typeof useWorkspaceCanvasTaskSupport> &
  ReturnType<typeof useWorkspaceCanvasTaskWindows> {
  const taskSupport = useWorkspaceCanvasTaskSupport({
    agentTaskTagOptions,
    readAgentSettings,
    readTerminalDisplayCalibration,
    createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    workspaceId,
    workspacePath,
    environmentVariables,
  })

  const taskWindows = useWorkspaceCanvasTaskWindows({
    workspaceId,
    taskTagOptions: taskSupport.taskTagOptions,
    suggestTaskTitle: taskSupport.suggestTaskTitle,
    standardWindowSizeBucket,
    createTaskNode,
    closeNode,
  })

  return { ...taskSupport, ...taskWindows }
}
