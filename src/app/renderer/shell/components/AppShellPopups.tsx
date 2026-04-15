import React from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type {
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
} from '@contexts/settings/domain/agentSettings'
import type { ProjectContextMenuState, ProjectMountManagerState } from '../types'
import { CommandCenter } from './CommandCenter'
import { AddProjectWizardWindow } from './AddProjectWizardWindow'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { ProjectContextMenu } from './ProjectContextMenu'
import { ProjectMountManagerWindow } from './ProjectMountManagerWindow'
import { SpaceArchiveRecordsWindow } from './SpaceArchiveRecordsWindow'

interface ProjectDeleteConfirmation {
  workspaceId: string
  workspaceName: string
}

export function AppShellPopups({
  isCommandCenterOpen,
  activeWorkspace,
  workspaces,
  isPrimarySidebarCollapsed,
  remoteWorkersEnabled,
  onCloseCommandCenter,
  onOpenSettings,
  onRequestOpenEndpoints,
  onOpenSpaceArchives,
  onTogglePrimarySidebar,
  onAddWorkspace,
  onSelectWorkspace,
  onSelectSpace,
  isSpaceArchivesOpen,
  canvasInputModeSetting,
  canvasWheelBehaviorSetting,
  canvasWheelZoomModifierSetting,
  onDeleteSpaceArchiveRecord,
  onCloseSpaceArchives,
  isAddProjectWizardOpen,
  onCloseAddProjectWizard,
  projectContextMenu,
  projectMountManager,
  onCloseProjectMountManager,
  onRequestManageProjectMounts,
  onRequestRemoveProject,
  projectDeleteConfirmation,
  isRemovingProject,
  onCancelProjectDelete,
  onConfirmProjectDelete,
}: {
  isCommandCenterOpen: boolean
  activeWorkspace: WorkspaceState | null
  workspaces: WorkspaceState[]
  isPrimarySidebarCollapsed: boolean
  remoteWorkersEnabled: boolean
  onCloseCommandCenter: () => void
  onOpenSettings: () => void
  onRequestOpenEndpoints: () => void
  onOpenSpaceArchives: () => void
  onTogglePrimarySidebar: () => void
  onAddWorkspace: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSpace: (spaceId: string | null) => void
  isSpaceArchivesOpen: boolean
  canvasInputModeSetting: 'mouse' | 'trackpad' | 'auto'
  canvasWheelBehaviorSetting: CanvasWheelBehavior
  canvasWheelZoomModifierSetting: CanvasWheelZoomModifier
  onDeleteSpaceArchiveRecord: (recordId: string) => void
  onCloseSpaceArchives: () => void
  isAddProjectWizardOpen: boolean
  onCloseAddProjectWizard: () => void
  projectContextMenu: ProjectContextMenuState | null
  projectMountManager: ProjectMountManagerState | null
  onCloseProjectMountManager: () => void
  onRequestManageProjectMounts: (workspaceId: string) => void
  onRequestRemoveProject: (workspaceId: string) => void
  projectDeleteConfirmation: ProjectDeleteConfirmation | null
  isRemovingProject: boolean
  onCancelProjectDelete: () => void
  onConfirmProjectDelete: () => void
}): React.JSX.Element {
  return (
    <>
      <CommandCenter
        isOpen={isCommandCenterOpen}
        activeWorkspace={activeWorkspace}
        workspaces={workspaces}
        isPrimarySidebarCollapsed={isPrimarySidebarCollapsed}
        onClose={() => {
          onCloseCommandCenter()
        }}
        onOpenSettings={() => {
          onOpenSettings()
        }}
        onOpenSpaceArchives={() => {
          onOpenSpaceArchives()
        }}
        onTogglePrimarySidebar={() => {
          onTogglePrimarySidebar()
        }}
        onAddWorkspace={() => {
          onAddWorkspace()
        }}
        onSelectWorkspace={workspaceId => {
          onSelectWorkspace(workspaceId)
        }}
        onSelectSpace={spaceId => {
          onSelectSpace(spaceId)
        }}
      />

      <SpaceArchiveRecordsWindow
        isOpen={isSpaceArchivesOpen}
        workspace={activeWorkspace}
        canvasInputModeSetting={canvasInputModeSetting}
        canvasWheelBehaviorSetting={canvasWheelBehaviorSetting}
        canvasWheelZoomModifierSetting={canvasWheelZoomModifierSetting}
        onDeleteRecord={onDeleteSpaceArchiveRecord}
        onClose={() => {
          onCloseSpaceArchives()
        }}
      />

      {isAddProjectWizardOpen ? (
        <AddProjectWizardWindow
          existingWorkspaces={workspaces}
          remoteWorkersEnabled={remoteWorkersEnabled}
          onClose={() => {
            onCloseAddProjectWizard()
          }}
          onRequestOpenEndpoints={onRequestOpenEndpoints}
        />
      ) : null}

      {projectContextMenu ? (
        <ProjectContextMenu
          workspaceId={projectContextMenu.workspaceId}
          x={projectContextMenu.x}
          y={projectContextMenu.y}
          onRequestManageMounts={workspaceId => {
            onRequestManageProjectMounts(workspaceId)
          }}
          onRequestRemove={workspaceId => {
            onRequestRemoveProject(workspaceId)
          }}
        />
      ) : null}

      {projectMountManager ? (
        <ProjectMountManagerWindow
          workspace={
            workspaces.find(workspace => workspace.id === projectMountManager.workspaceId) ?? null
          }
          remoteWorkersEnabled={remoteWorkersEnabled}
          onClose={onCloseProjectMountManager}
          onRequestOpenEndpoints={onRequestOpenEndpoints}
        />
      ) : null}

      {projectDeleteConfirmation ? (
        <DeleteProjectDialog
          workspaceName={projectDeleteConfirmation.workspaceName}
          isRemoving={isRemovingProject}
          onCancel={() => {
            onCancelProjectDelete()
          }}
          onConfirm={() => {
            onConfirmProjectDelete()
          }}
        />
      ) : null}
    </>
  )
}
