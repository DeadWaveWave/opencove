import React from 'react'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type {
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
} from '@contexts/settings/domain/agentSettings'
import type { ProjectContextMenuState } from '../types'
import { CommandCenter } from './CommandCenter'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { ProjectContextMenu } from './ProjectContextMenu'
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
  onCloseCommandCenter,
  onOpenSettings,
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
  projectContextMenu,
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
  onCloseCommandCenter: () => void
  onOpenSettings: () => void
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
  projectContextMenu: ProjectContextMenuState | null
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

      {projectContextMenu ? (
        <ProjectContextMenu
          workspaceId={projectContextMenu.workspaceId}
          x={projectContextMenu.x}
          y={projectContextMenu.y}
          onRequestRemove={workspaceId => {
            onRequestRemoveProject(workspaceId)
          }}
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
