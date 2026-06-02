import React from 'react'
import type {
  AgentProvider,
  ProjectRoleDefinition,
  QuickCommand,
  QuickPhrase,
} from '@contexts/settings/domain/agentSettings'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import type { WorkspaceSpaceState } from '../../../types'
import type {
  WorkspaceArrangeOrder,
  WorkspaceArrangeSpaceFit,
} from '../../../utils/workspaceArrange'
import type { ContextMenuState } from '../types'
import {
  WorkspaceContextArrangeBySubmenu,
  type ArrangeScope,
} from './WorkspaceContextArrangeBySubmenu'
import {
  WorkspaceContextAgentProviderSubmenu,
  WorkspaceContextLabelColorSubmenu,
} from './WorkspaceContextMenuParts'
import type { OpenSubmenu } from './WorkspaceContextMenu.types'
import {
  WorkspaceContextQuickCommandsSubmenu,
  WorkspaceContextQuickPhrasesSubmenu,
} from './WorkspaceContextMenuQuickMenuParts'
import { WorkspaceContextProjectRolesSubmenu } from './WorkspaceContextRoleMenuParts'

export function WorkspaceContextSubmenus({
  contextMenu,
  openSubmenu,
  submenuRef,
  sharedSubmenuStyle,
  contextHitSpace,
  canArrangeAll,
  canArrangeCanvas,
  canArrangeHitSpace,
  arrangeScope,
  arrangeOrder,
  arrangeSpaceFit,
  arrangePreserveWindowSizes,
  handleArrangeScopeSelect,
  handleArrangeOrderSelect,
  handleArrangeSpaceFitSelect,
  handleArrangePreserveWindowSizesSelect,
  sortedInstalledProviders,
  enabledQuickCommands,
  enabledQuickPhrases,
  projectRoles,
  openRoleCreator,
  keepAgentProviderSubmenuOpen,
  keepQuickCommandsSubmenuOpen,
  keepQuickPhrasesSubmenuOpen,
  keepProjectRolesSubmenuOpen,
  keepLabelColorSubmenuOpen,
  scheduleSubmenuClose,
  openAgentLauncherForProvider,
  runQuickCommand,
  insertQuickPhrase,
  openQuickMenuSettings,
  closeContextMenu,
  setOpenSubmenu,
  runProjectRoleFromContextMenu,
  openRoleEditor,
  deleteProjectRole,
  setSelectedNodeLabelColorOverride,
}: {
  contextMenu: ContextMenuState
  openSubmenu: OpenSubmenu
  submenuRef: React.RefObject<HTMLDivElement | null>
  sharedSubmenuStyle: React.CSSProperties
  contextHitSpace: WorkspaceSpaceState | null
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  canArrangeHitSpace: boolean
  arrangeScope: ArrangeScope
  arrangeOrder: WorkspaceArrangeOrder
  arrangeSpaceFit: WorkspaceArrangeSpaceFit
  arrangePreserveWindowSizes: boolean
  handleArrangeScopeSelect: (scope: ArrangeScope) => void
  handleArrangeOrderSelect: (order: WorkspaceArrangeOrder) => void
  handleArrangeSpaceFitSelect: (fit: WorkspaceArrangeSpaceFit) => void
  handleArrangePreserveWindowSizesSelect: (enabled: boolean) => void
  sortedInstalledProviders: AgentProvider[]
  enabledQuickCommands: QuickCommand[]
  enabledQuickPhrases: QuickPhrase[]
  projectRoles: ProjectRoleDefinition[]
  openRoleCreator: () => void
  keepAgentProviderSubmenuOpen: () => void
  keepQuickCommandsSubmenuOpen: () => void
  keepQuickPhrasesSubmenuOpen: () => void
  keepProjectRolesSubmenuOpen: () => void
  keepLabelColorSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  openAgentLauncherForProvider: (provider: AgentProvider) => void
  runQuickCommand: (command: QuickCommand) => Promise<void>
  insertQuickPhrase: (phrase: QuickPhrase) => void
  openQuickMenuSettings: () => void
  closeContextMenu: () => void
  setOpenSubmenu: React.Dispatch<React.SetStateAction<OpenSubmenu>>
  runProjectRoleFromContextMenu: (roleId: string) => void
  openRoleEditor: (roleId: string) => void
  deleteProjectRole: (roleId: string) => void
  setSelectedNodeLabelColorOverride: (labelColorOverride: NodeLabelColorOverride) => void
}): React.JSX.Element {
  const shouldShowArrangeSubmenu = contextMenu.kind === 'pane' && openSubmenu === 'arrangeBy'
  const shouldShowAgentProviderSubmenu =
    contextMenu.kind === 'pane' &&
    openSubmenu === 'agent-providers' &&
    sortedInstalledProviders.length > 0
  const shouldShowQuickCommandsSubmenu =
    contextMenu.kind === 'pane' && openSubmenu === 'quick-commands'
  const shouldShowQuickPhrasesSubmenu =
    contextMenu.kind === 'pane' && openSubmenu === 'quick-phrases'
  const shouldShowProjectRolesSubmenu =
    contextMenu.kind === 'pane' && openSubmenu === 'project-roles'
  const shouldShowLabelColorSubmenu =
    contextMenu.kind === 'selection' && openSubmenu === 'label-color'

  return (
    <>
      {shouldShowArrangeSubmenu ? (
        <WorkspaceContextArrangeBySubmenu
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          hitSpace={contextHitSpace}
          canArrangeAll={canArrangeAll}
          canArrangeCanvas={canArrangeCanvas}
          canArrangeHitSpace={canArrangeHitSpace}
          arrangeScope={arrangeScope}
          arrangeOrder={arrangeOrder}
          arrangeSpaceFit={arrangeSpaceFit}
          preserveWindowSizes={arrangePreserveWindowSizes}
          onSelectScope={handleArrangeScopeSelect}
          onSelectOrder={handleArrangeOrderSelect}
          onSelectSpaceFit={handleArrangeSpaceFitSelect}
          onSelectPreserveWindowSizes={handleArrangePreserveWindowSizesSelect}
        />
      ) : null}

      {shouldShowAgentProviderSubmenu ? (
        <WorkspaceContextAgentProviderSubmenu
          sortedInstalledProviders={sortedInstalledProviders}
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepAgentProviderSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          openAgentLauncherForProvider={openAgentLauncherForProvider}
        />
      ) : null}

      {shouldShowQuickCommandsSubmenu ? (
        <WorkspaceContextQuickCommandsSubmenu
          commands={enabledQuickCommands}
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepQuickCommandsSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          runQuickCommand={runQuickCommand}
          openQuickMenuSettings={() => {
            closeContextMenu()
            setOpenSubmenu(null)
            openQuickMenuSettings()
          }}
        />
      ) : null}

      {shouldShowQuickPhrasesSubmenu ? (
        <WorkspaceContextQuickPhrasesSubmenu
          phrases={enabledQuickPhrases}
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepQuickPhrasesSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          insertQuickPhrase={insertQuickPhrase}
          openQuickMenuSettings={() => {
            closeContextMenu()
            setOpenSubmenu(null)
            openQuickMenuSettings()
          }}
        />
      ) : null}

      {shouldShowProjectRolesSubmenu ? (
        <WorkspaceContextProjectRolesSubmenu
          projectRoles={projectRoles}
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepProjectRolesSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          runProjectRoleFromContextMenu={runProjectRoleFromContextMenu}
          openRoleCreator={openRoleCreator}
          openRoleEditor={openRoleEditor}
          deleteProjectRole={deleteProjectRole}
        />
      ) : null}

      {shouldShowLabelColorSubmenu ? (
        <WorkspaceContextLabelColorSubmenu
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepLabelColorSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          setSelectedNodeLabelColorOverride={setSelectedNodeLabelColorOverride}
          closeContextMenu={closeContextMenu}
        />
      ) : null}
    </>
  )
}
