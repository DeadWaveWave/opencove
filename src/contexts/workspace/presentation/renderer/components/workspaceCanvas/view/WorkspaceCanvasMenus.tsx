import React from 'react'
import type { WorkspaceCanvasViewProps } from '../WorkspaceCanvasView.types'
import { useCanvasUi, useCanvasUiCommands } from '../../../store/canvasStoreContext'
import { useWorkspaceCanvasMenuDismissals } from './useCanvasMenuDismissals'
import { useSpacePathOpeners } from './useSpacePathOpeners'
import {
  CLOSED_CANVAS_ARRANGE_FLAGS,
  resolveCanvasArrangeFlags,
  useWorkspaceCanvasSpaceMenuState,
} from '../hooks/useCanvasSpaceMenuState'
import { WorkspaceContextMenu } from './WorkspaceContextMenu'
import { WorkspaceSpaceActionMenu } from './WorkspaceSpaceActionMenu'

export function WorkspaceCanvasMenus({
  nodes,
  workspacePath,
  createTerminalNode,
  createNoteNodeFromContextMenu,
  createWebsiteNodeFromContextMenu,
  createPluginNodeFromContextMenu,
  openTaskCreator,
  openRoleCreator,
  openAgentLauncher,
  openAgentLauncherForProvider,
  projectRoles,
  runProjectRoleFromContextMenu,
  openRoleEditor,
  deleteProjectRole,
  runQuickCommand,
  insertQuickPhrase,
  openQuickMenuSettings,
  spaces,
  magneticSnappingEnabled,
  onToggleMagneticSnapping,
  arrangeAll,
  arrangeCanvas,
  arrangeInSpace,
  createSpaceFromSelectedNodes,
  createChildSpaceInParent,
  createEmptySpaceAtPoint,
  clearNodeSelection,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
  setSelectedNodeLabelColorOverride,
  setSpaceLabelColor,
  openSpaceCreateWorktree,
  openSpaceArchive,
  copySpacePath,
  openSpacePath,
  agentSettings,
  onChangePreserveWindowSizesOnArrange,
}: Pick<
  WorkspaceCanvasViewProps,
  | 'nodes'
  | 'workspacePath'
  | 'createTerminalNode'
  | 'createNoteNodeFromContextMenu'
  | 'createWebsiteNodeFromContextMenu'
  | 'createPluginNodeFromContextMenu'
  | 'openTaskCreator'
  | 'openRoleCreator'
  | 'openAgentLauncher'
  | 'openAgentLauncherForProvider'
  | 'projectRoles'
  | 'runProjectRoleFromContextMenu'
  | 'openRoleEditor'
  | 'deleteProjectRole'
  | 'runQuickCommand'
  | 'insertQuickPhrase'
  | 'openQuickMenuSettings'
  | 'spaces'
  | 'magneticSnappingEnabled'
  | 'onToggleMagneticSnapping'
  | 'arrangeAll'
  | 'arrangeCanvas'
  | 'arrangeInSpace'
  | 'createSpaceFromSelectedNodes'
  | 'createChildSpaceInParent'
  | 'createEmptySpaceAtPoint'
  | 'clearNodeSelection'
  | 'canConvertSelectedNoteToTask'
  | 'isConvertSelectedNoteToTaskDisabled'
  | 'convertSelectedNoteToTask'
  | 'setSelectedNodeLabelColorOverride'
  | 'setSpaceLabelColor'
  | 'openSpaceCreateWorktree'
  | 'openSpaceArchive'
  | 'copySpacePath'
  | 'openSpacePath'
  | 'agentSettings'
  | 'onChangePreserveWindowSizesOnArrange'
>): React.JSX.Element {
  // The menus' leaf owns the subscriptions: opening a menu re-renders this component only.
  const contextMenu = useCanvasUi(state => state.contextMenu)
  const spaceActionMenu = useCanvasUi(state => state.spaceActionMenu)
  const ui = useCanvasUiCommands()
  const availablePathOpeners = useSpacePathOpeners(spaceActionMenu)
  useWorkspaceCanvasMenuDismissals()

  const { activeMenuSpace, canCreateWorktreeForActiveMenuSpace } = useWorkspaceCanvasSpaceMenuState(
    { spaceActionMenu, spaces, workspacePath },
  )
  const isAnyMenuOpen = contextMenu !== null || spaceActionMenu !== null
  const { canArrangeAll, canArrangeCanvas, canArrangeActiveSpace } = React.useMemo(
    () =>
      isAnyMenuOpen
        ? resolveCanvasArrangeFlags(nodes, spaces, activeMenuSpace)
        : CLOSED_CANVAS_ARRANGE_FLAGS,
    [activeMenuSpace, isAnyMenuOpen, nodes, spaces],
  )
  const arrangePreserveWindowSizes = agentSettings.preserveWindowSizesOnArrange
  const arrangeStyle = React.useMemo(
    () => ({ alignCanonicalSizes: !arrangePreserveWindowSizes }),
    [arrangePreserveWindowSizes],
  )

  return (
    <>
      <WorkspaceContextMenu
        contextMenu={contextMenu}
        closeContextMenu={ui.closeMenus}
        createTerminalNode={createTerminalNode}
        createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
        createWebsiteNodeFromContextMenu={createWebsiteNodeFromContextMenu}
        createPluginNodeFromContextMenu={createPluginNodeFromContextMenu}
        websiteWindowsEnabled={agentSettings.websiteWindowPolicy.enabled}
        openTaskCreator={openTaskCreator}
        openRoleCreator={openRoleCreator}
        openAgentLauncher={openAgentLauncher}
        agentProviderOrder={agentSettings.agentProviderOrder}
        agentExecutablePathOverrideByProvider={agentSettings.agentExecutablePathOverrideByProvider}
        openAgentLauncherForProvider={openAgentLauncherForProvider}
        projectRoles={projectRoles}
        runProjectRoleFromContextMenu={runProjectRoleFromContextMenu}
        openRoleEditor={openRoleEditor}
        deleteProjectRole={deleteProjectRole}
        quickCommands={agentSettings.quickCommands}
        quickPhrases={agentSettings.quickPhrases}
        runQuickCommand={runQuickCommand}
        insertQuickPhrase={insertQuickPhrase}
        openQuickMenuSettings={openQuickMenuSettings}
        keybindings={agentSettings.keybindings}
        spaces={spaces}
        magneticSnappingEnabled={magneticSnappingEnabled}
        onToggleMagneticSnapping={onToggleMagneticSnapping}
        arrangePreserveWindowSizes={arrangePreserveWindowSizes}
        onChangeArrangePreserveWindowSizes={onChangePreserveWindowSizesOnArrange}
        canArrangeAll={canArrangeAll}
        canArrangeCanvas={canArrangeCanvas}
        arrangeAll={arrangeAll}
        arrangeCanvas={arrangeCanvas}
        arrangeInSpace={arrangeInSpace}
        createSpaceFromSelectedNodes={createSpaceFromSelectedNodes}
        createChildSpaceInParent={createChildSpaceInParent}
        createEmptySpaceAtPoint={createEmptySpaceAtPoint}
        clearNodeSelection={clearNodeSelection}
        canConvertSelectedNoteToTask={canConvertSelectedNoteToTask}
        isConvertSelectedNoteToTaskDisabled={isConvertSelectedNoteToTaskDisabled}
        convertSelectedNoteToTask={convertSelectedNoteToTask}
        setSelectedNodeLabelColorOverride={setSelectedNodeLabelColorOverride}
      />
      <WorkspaceSpaceActionMenu
        menu={spaceActionMenu}
        availableOpeners={availablePathOpeners}
        canArrange={canArrangeActiveSpace}
        canCreateWorktree={canCreateWorktreeForActiveMenuSpace}
        canArchive={activeMenuSpace !== null}
        currentLabelColor={activeMenuSpace?.labelColor ?? null}
        closeMenu={ui.closeSpaceActionMenu}
        setSpaceLabelColor={setSpaceLabelColor}
        preserveWindowSizes={arrangePreserveWindowSizes}
        onChangePreserveWindowSizes={onChangePreserveWindowSizesOnArrange}
        onArrange={spaceId => arrangeInSpace(spaceId, arrangeStyle)}
        onCreateWorktree={anchor => {
          if (activeMenuSpace) {
            openSpaceCreateWorktree(activeMenuSpace.id, anchor)
          }
        }}
        onArchive={anchor => {
          if (activeMenuSpace) {
            openSpaceArchive(activeMenuSpace.id, anchor)
          }
        }}
        onCopyPath={() => {
          if (activeMenuSpace) {
            return copySpacePath(activeMenuSpace.id)
          }
        }}
        onOpenPath={openerId => {
          if (activeMenuSpace) {
            return openSpacePath(activeMenuSpace.id, openerId)
          }
        }}
      />
    </>
  )
}
