import React from 'react'
import { useCanvasUi, useCanvasUiCommands } from '../../../store/canvasStoreContext'
import type { WorkspaceCanvasViewProps } from '../WorkspaceCanvasView.types'
import { NodeDeleteConfirmationWindow } from '../windows/NodeDeleteConfirmationWindow'
import { SpaceWorktreeMismatchDropWarningWindow } from '../windows/SpaceWorktreeMismatchDropWarningWindow'
import { SpaceTargetMountPickerWindow } from '../windows/SpaceTargetMountPickerWindow'
import { SpaceWorktreeWindow } from '../windows/SpaceWorktreeWindow'
import { RoleCreatorWindow } from '../windows/RoleCreatorWindow'
import { TaskEditorWindow } from '../windows/TaskEditorWindow'

export function WorkspaceCanvasWindows({
  taskTitleProviderLabel,
  taskTitleModelLabel,
  taskTagOptions,
  closeRoleCreator,
  createRole,
  closeTaskEditor,
  generateTaskEditorTitle,
  saveTaskEdits,
  confirmSpaceTargetMountPicker,
  cancelSpaceTargetMountPicker,
  confirmNodeDelete,
  spaceWorktreeMismatchDropWarning,
  cancelSpaceWorktreeMismatchDropWarning,
  continueSpaceWorktreeMismatchDropWarning,
  spaceWorktreeOperations,
  spaces,
  nodes,
  workspacePath,
  worktreesRoot,
  agentSettings,
  closeSpaceWorktree,
  setSpaceWorktreeOperationPhase,
  onShowMessage,
  onAppendSpaceArchiveRecord,
  updateSpaceDirectory,
  getSpaceBlockingNodes,
  closeNodesById,
}: Pick<
  WorkspaceCanvasViewProps,
  | 'taskTitleProviderLabel'
  | 'taskTitleModelLabel'
  | 'taskTagOptions'
  | 'closeRoleCreator'
  | 'createRole'
  | 'closeTaskEditor'
  | 'generateTaskEditorTitle'
  | 'saveTaskEdits'
  | 'confirmSpaceTargetMountPicker'
  | 'cancelSpaceTargetMountPicker'
  | 'confirmNodeDelete'
  | 'spaceWorktreeMismatchDropWarning'
  | 'cancelSpaceWorktreeMismatchDropWarning'
  | 'continueSpaceWorktreeMismatchDropWarning'
  | 'spaceWorktreeOperations'
  | 'spaces'
  | 'nodes'
  | 'workspacePath'
  | 'worktreesRoot'
  | 'agentSettings'
  | 'closeSpaceWorktree'
  | 'setSpaceWorktreeOperationPhase'
  | 'onShowMessage'
  | 'onAppendSpaceArchiveRecord'
  | 'updateSpaceDirectory'
  | 'getSpaceBlockingNodes'
  | 'closeNodesById'
>): React.JSX.Element {
  const ui = useCanvasUiCommands()
  const roleCreator = useCanvasUi(state => state.roleCreator)
  const taskEditor = useCanvasUi(state => state.taskEditor)
  const spaceTargetMountPicker = useCanvasUi(state => state.spaceTargetMountPicker)
  const nodeDeleteConfirmation = useCanvasUi(state => state.nodeDeleteConfirmation)

  return (
    <>
      <RoleCreatorWindow
        roleCreator={roleCreator}
        update={recipe => ui.updateDialog('roleCreator', recipe)}
        closeRoleCreator={closeRoleCreator}
        createRole={createRole}
      />

      <TaskEditorWindow
        taskEditor={taskEditor}
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskTagOptions}
        update={recipe => ui.updateDialog('taskEditor', recipe)}
        closeTaskEditor={closeTaskEditor}
        generateTaskEditorTitle={generateTaskEditorTitle}
        saveTaskEdits={saveTaskEdits}
      />

      <SpaceTargetMountPickerWindow
        picker={spaceTargetMountPicker}
        updatePicker={recipe => ui.updateDialog('spaceTargetMountPicker', recipe)}
        onCancel={cancelSpaceTargetMountPicker}
        onConfirm={confirmSpaceTargetMountPicker}
      />

      <NodeDeleteConfirmationWindow
        nodeDeleteConfirmation={nodeDeleteConfirmation}
        close={() => ui.closeDialog('nodeDeleteConfirmation')}
        confirmNodeDelete={confirmNodeDelete}
      />

      <SpaceWorktreeMismatchDropWarningWindow
        warning={spaceWorktreeMismatchDropWarning}
        onCancel={cancelSpaceWorktreeMismatchDropWarning}
        onContinue={continueSpaceWorktreeMismatchDropWarning}
      />

      {spaceWorktreeOperations.map(operation => (
        <SpaceWorktreeWindow
          key={operation.id}
          spaceId={operation.spaceId}
          initialViewMode={operation.initialViewMode}
          anchor={operation.anchor}
          operationPhase={operation.phase}
          spaces={spaces}
          nodes={nodes}
          workspacePath={workspacePath}
          worktreesRoot={worktreesRoot}
          agentSettings={agentSettings}
          onClose={() => {
            closeSpaceWorktree(operation.id)
          }}
          onOperationPhaseChange={phase => {
            setSpaceWorktreeOperationPhase(operation.id, phase)
          }}
          onShowMessage={onShowMessage}
          onAppendSpaceArchiveRecord={onAppendSpaceArchiveRecord}
          onUpdateSpaceDirectory={(spaceId, directoryPath, options) => {
            updateSpaceDirectory(spaceId, directoryPath, options)
          }}
          getBlockingNodes={spaceId => getSpaceBlockingNodes(spaceId)}
          closeNodesById={nodeIds => closeNodesById(nodeIds)}
        />
      ))}
    </>
  )
}
