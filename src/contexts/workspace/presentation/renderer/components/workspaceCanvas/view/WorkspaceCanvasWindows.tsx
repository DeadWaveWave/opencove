import React from 'react'
import type { WorkspaceCanvasViewProps } from '../WorkspaceCanvasView.types'
import { NodeDeleteConfirmationWindow } from '../windows/NodeDeleteConfirmationWindow'
import { SpaceWorktreeMismatchDropWarningWindow } from '../windows/SpaceWorktreeMismatchDropWarningWindow'
import { SpaceWorktreeWindow } from '../windows/SpaceWorktreeWindow'
import { TaskCreatorWindow } from '../windows/TaskCreatorWindow'
import { TaskEditorWindow } from '../windows/TaskEditorWindow'

export function WorkspaceCanvasWindows({
  taskCreator,
  taskTitleProviderLabel,
  taskTitleModelLabel,
  taskTagOptions,
  setTaskCreator,
  closeTaskCreator,
  generateTaskTitle,
  createTask,
  taskEditor,
  setTaskEditor,
  closeTaskEditor,
  generateTaskEditorTitle,
  saveTaskEdits,
  nodeDeleteConfirmation,
  setNodeDeleteConfirmation,
  confirmNodeDelete,
  spaceWorktreeMismatchDropWarning,
  cancelSpaceWorktreeMismatchDropWarning,
  continueSpaceWorktreeMismatchDropWarning,
  spaceWorktreeDialog,
  spaces,
  nodes,
  workspacePath,
  worktreesRoot,
  agentSettings,
  closeSpaceWorktree,
  onShowMessage,
  updateSpaceDirectory,
  getSpaceBlockingNodes,
  closeNodesById,
}: Pick<
  WorkspaceCanvasViewProps,
  | 'taskCreator'
  | 'taskTitleProviderLabel'
  | 'taskTitleModelLabel'
  | 'taskTagOptions'
  | 'setTaskCreator'
  | 'closeTaskCreator'
  | 'generateTaskTitle'
  | 'createTask'
  | 'taskEditor'
  | 'setTaskEditor'
  | 'closeTaskEditor'
  | 'generateTaskEditorTitle'
  | 'saveTaskEdits'
  | 'nodeDeleteConfirmation'
  | 'setNodeDeleteConfirmation'
  | 'confirmNodeDelete'
  | 'spaceWorktreeMismatchDropWarning'
  | 'cancelSpaceWorktreeMismatchDropWarning'
  | 'continueSpaceWorktreeMismatchDropWarning'
  | 'spaceWorktreeDialog'
  | 'spaces'
  | 'nodes'
  | 'workspacePath'
  | 'worktreesRoot'
  | 'agentSettings'
  | 'closeSpaceWorktree'
  | 'onShowMessage'
  | 'updateSpaceDirectory'
  | 'getSpaceBlockingNodes'
  | 'closeNodesById'
>): React.JSX.Element {
  return (
    <>
      <TaskCreatorWindow
        taskCreator={taskCreator}
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskTagOptions}
        setTaskCreator={setTaskCreator}
        closeTaskCreator={closeTaskCreator}
        generateTaskTitle={generateTaskTitle}
        createTask={createTask}
      />

      <TaskEditorWindow
        taskEditor={taskEditor}
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskTagOptions}
        setTaskEditor={setTaskEditor}
        closeTaskEditor={closeTaskEditor}
        generateTaskEditorTitle={generateTaskEditorTitle}
        saveTaskEdits={saveTaskEdits}
      />

      <NodeDeleteConfirmationWindow
        nodeDeleteConfirmation={nodeDeleteConfirmation}
        setNodeDeleteConfirmation={setNodeDeleteConfirmation}
        confirmNodeDelete={confirmNodeDelete}
      />

      <SpaceWorktreeMismatchDropWarningWindow
        warning={spaceWorktreeMismatchDropWarning}
        onCancel={cancelSpaceWorktreeMismatchDropWarning}
        onContinue={continueSpaceWorktreeMismatchDropWarning}
      />

      <SpaceWorktreeWindow
        spaceId={spaceWorktreeDialog?.spaceId ?? null}
        initialViewMode={spaceWorktreeDialog?.initialViewMode ?? 'create'}
        spaces={spaces}
        nodes={nodes}
        workspacePath={workspacePath}
        worktreesRoot={worktreesRoot}
        agentSettings={agentSettings}
        onClose={closeSpaceWorktree}
        onShowMessage={onShowMessage}
        onUpdateSpaceDirectory={(spaceId, directoryPath, options) => {
          updateSpaceDirectory(spaceId, directoryPath, options)
        }}
        getBlockingNodes={spaceId => getSpaceBlockingNodes(spaceId)}
        closeNodesById={nodeIds => closeNodesById(nodeIds)}
      />
    </>
  )
}
