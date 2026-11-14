import React from 'react'
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
  roleCreator,
  setRoleCreator,
  closeRoleCreator,
  createRole,
  taskEditor,
  setTaskEditor,
  closeTaskEditor,
  generateTaskEditorTitle,
  saveTaskEdits,
  spaceTargetMountPicker,
  setSpaceTargetMountPicker,
  confirmSpaceTargetMountPicker,
  cancelSpaceTargetMountPicker,
  nodeDeleteConfirmation,
  setNodeDeleteConfirmation,
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
  | 'roleCreator'
  | 'setRoleCreator'
  | 'closeRoleCreator'
  | 'createRole'
  | 'taskEditor'
  | 'setTaskEditor'
  | 'closeTaskEditor'
  | 'generateTaskEditorTitle'
  | 'saveTaskEdits'
  | 'spaceTargetMountPicker'
  | 'setSpaceTargetMountPicker'
  | 'confirmSpaceTargetMountPicker'
  | 'cancelSpaceTargetMountPicker'
  | 'nodeDeleteConfirmation'
  | 'setNodeDeleteConfirmation'
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
  return (
    <>
      <RoleCreatorWindow
        roleCreator={roleCreator}
        setRoleCreator={setRoleCreator}
        closeRoleCreator={closeRoleCreator}
        createRole={createRole}
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

      <SpaceTargetMountPickerWindow
        picker={spaceTargetMountPicker}
        setPicker={setSpaceTargetMountPicker}
        onCancel={cancelSpaceTargetMountPicker}
        onConfirm={confirmSpaceTargetMountPicker}
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
