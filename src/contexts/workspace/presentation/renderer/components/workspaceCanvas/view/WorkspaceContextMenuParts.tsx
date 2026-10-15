import React from 'react'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { menuHoverHandler } from '@app/renderer/components/menuHoverHandler'
import { MenuCheckboxItem, MenuItem } from '@app/renderer/components/ui/Menu'
import {
  FileText,
  Globe,
  LayoutGrid,
  ListTodo,
  Magnet,
  Play,
  Scan,
  SlidersHorizontal,
  Terminal,
} from 'lucide-react'
import { PluginIcon } from '@contexts/plugins/presentation/renderer/PluginIcon'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  type AgentProvider,
  type QuickCommand,
} from '@contexts/settings/domain/agentSettings'
import { LABEL_COLORS, type NodeLabelColorOverride } from '@shared/types/labelColor'
import { WorkspaceContextQuickMenuItems } from './WorkspaceContextMenuQuickMenuParts'
import { WorkspaceContextRoleMenuItems } from './WorkspaceContextRoleMenuParts'
import { useLocalPluginContributions } from '@contexts/plugins/presentation/renderer/useLocalPluginContributions'
import type { CanvasMenuShortcuts } from './useCanvasMenuShortcuts'

export function WorkspaceContextPaneMenuContent({
  shortcuts,
  createTerminalNode,
  createNoteNodeFromContextMenu,
  createWebsiteNodeFromContextMenu,
  createPluginNodeFromContextMenu,
  websiteWindowsEnabled,
  openTaskCreator,
  roleButtonRef,
  openProjectRolesSubmenu,
  isProjectRolesSubmenuOpen,
  openAgentLauncher,
  createSpaceFromContextMenu,
  canCreateSpace,
  openAgentProviderSubmenu,
  agentProviderToggleRef,
  isLoadingInstalledProviders,
  isAgentProviderSubmenuOpen,
  pinnedQuickCommands,
  runQuickCommand,
  quickCommandsButtonRef,
  openQuickCommandsSubmenu,
  isQuickCommandsSubmenuOpen,
  quickPhrasesButtonRef,
  openQuickPhrasesSubmenu,
  isQuickPhrasesSubmenuOpen,
  openQuickMenuSettings,
  canArrangeCurrentScope,
  commitArrangeAndClose,
  arrangeByButtonRef,
  openArrangeSubmenu,
  isArrangeSubmenuOpen,
  magneticSnappingEnabled,
  onToggleMagneticSnapping,
}: {
  shortcuts: CanvasMenuShortcuts
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  createWebsiteNodeFromContextMenu: () => void
  createPluginNodeFromContextMenu: (pluginId: string) => void
  websiteWindowsEnabled: boolean
  openTaskCreator: () => void
  roleButtonRef: React.RefObject<HTMLButtonElement | null>
  openProjectRolesSubmenu: () => void
  isProjectRolesSubmenuOpen: boolean
  openAgentLauncher: () => void
  createSpaceFromContextMenu: () => void
  canCreateSpace: boolean
  openAgentProviderSubmenu: () => void
  agentProviderToggleRef: React.RefObject<HTMLButtonElement | null>
  isLoadingInstalledProviders: boolean
  isAgentProviderSubmenuOpen: boolean
  pinnedQuickCommands: QuickCommand[]
  runQuickCommand: (command: QuickCommand) => Promise<void>
  quickCommandsButtonRef: React.RefObject<HTMLButtonElement | null>
  openQuickCommandsSubmenu: () => void
  isQuickCommandsSubmenuOpen: boolean
  quickPhrasesButtonRef: React.RefObject<HTMLButtonElement | null>
  openQuickPhrasesSubmenu: () => void
  isQuickPhrasesSubmenuOpen: boolean
  openQuickMenuSettings: () => void
  canArrangeCurrentScope: boolean
  commitArrangeAndClose: () => void
  arrangeByButtonRef: React.RefObject<HTMLButtonElement | null>
  openArrangeSubmenu: () => void
  isArrangeSubmenuOpen: boolean
  magneticSnappingEnabled: boolean
  onToggleMagneticSnapping: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const localPlugins = useLocalPluginContributions('contextMenu')

  return (
    <>
      <MenuItem
        icon={<Terminal />}
        shortcut={shortcuts.createTerminal}
        data-testid="workspace-context-new-terminal"
        onClick={() => {
          void createTerminalNode()
        }}
      >
        {t('workspaceContextMenu.newTerminal')}
      </MenuItem>
      <MenuItem
        icon={<FileText />}
        shortcut={shortcuts.createNote}
        data-testid="workspace-context-new-note"
        onClick={createNoteNodeFromContextMenu}
      >
        {t('workspaceContextMenu.newNote')}
      </MenuItem>
      {websiteWindowsEnabled ? (
        <MenuItem
          icon={<Globe />}
          data-testid="workspace-context-new-website"
          onClick={createWebsiteNodeFromContextMenu}
        >
          {t('workspaceContextMenu.newWebsite')}
        </MenuItem>
      ) : null}
      {localPlugins.map(plugin => (
        <MenuItem
          key={plugin.id}
          icon={<PluginIcon pluginId={plugin.id} />}
          data-testid={`workspace-context-new-plugin-${plugin.id}`}
          onClick={() => createPluginNodeFromContextMenu(plugin.id)}
        >
          {plugin.displayName}
        </MenuItem>
      ))}
      <MenuItem
        icon={<ListTodo />}
        data-testid="workspace-context-new-task"
        onClick={openTaskCreator}
      >
        {t('workspaceContextMenu.newTask')}
      </MenuItem>

      <WorkspaceContextRoleMenuItems
        roleButtonRef={roleButtonRef}
        openProjectRolesSubmenu={openProjectRolesSubmenu}
        isProjectRolesSubmenuOpen={isProjectRolesSubmenuOpen}
      />

      <div className="cove-menu-split">
        <MenuItem
          icon={<Play />}
          shortcut={shortcuts.createAgent}
          data-testid="workspace-context-run-default-agent"
          onClick={openAgentLauncher}
        >
          {t('workspaceContextMenu.runAgent')}
        </MenuItem>
        <MenuItem
          ref={agentProviderToggleRef}
          data-testid="workspace-context-run-agent-provider-toggle"
          aria-label={t('workspaceContextMenu.chooseAgent')}
          submenu={{ open: isAgentProviderSubmenuOpen, loading: isLoadingInstalledProviders }}
          onMouseEnter={menuHoverHandler(openAgentProviderSubmenu)}
          onClick={openAgentProviderSubmenu}
        />
      </div>
      {canCreateSpace ? (
        <MenuItem
          icon={<Scan />}
          data-testid="workspace-context-create-space"
          onClick={createSpaceFromContextMenu}
        >
          {t('workspaceContextMenu.createSpace')}
        </MenuItem>
      ) : null}
      <WorkspaceContextQuickMenuItems
        pinnedQuickCommands={pinnedQuickCommands}
        runQuickCommand={runQuickCommand}
        quickCommandsButtonRef={quickCommandsButtonRef}
        openQuickCommandsSubmenu={openQuickCommandsSubmenu}
        isQuickCommandsSubmenuOpen={isQuickCommandsSubmenuOpen}
        quickPhrasesButtonRef={quickPhrasesButtonRef}
        openQuickPhrasesSubmenu={openQuickPhrasesSubmenu}
        isQuickPhrasesSubmenuOpen={isQuickPhrasesSubmenuOpen}
        openQuickMenuSettings={openQuickMenuSettings}
      />

      <MenuItem
        icon={<LayoutGrid />}
        data-testid="workspace-context-arrange"
        disabled={!canArrangeCurrentScope}
        onClick={commitArrangeAndClose}
      >
        {t('workspaceContextMenu.arrange')}
      </MenuItem>

      <MenuItem
        ref={arrangeByButtonRef}
        icon={<SlidersHorizontal />}
        data-testid="workspace-context-arrange-by"
        submenu={{ open: isArrangeSubmenuOpen }}
        onMouseEnter={menuHoverHandler(openArrangeSubmenu)}
        onClick={openArrangeSubmenu}
      >
        {t('workspaceContextMenu.arrangeBy')}
      </MenuItem>

      <MenuCheckboxItem
        icon={<Magnet />}
        data-testid="workspace-context-magnetic-snapping"
        checked={magneticSnappingEnabled}
        onCheckedChange={onToggleMagneticSnapping}
      >
        {t('workspaceArrangeMenu.magneticSnapping')}
      </MenuCheckboxItem>
    </>
  )
}

export function WorkspaceContextAgentProviderSubmenu({
  sortedInstalledProviders,
  submenuRef,
  style,
  keepSubmenuOpen,
  scheduleSubmenuClose,
  openAgentLauncherForProvider,
  onBack,
  onDismiss,
}: {
  sortedInstalledProviders: AgentProvider[]
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  keepSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  openAgentLauncherForProvider: (provider: AgentProvider) => void
  onBack: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <ViewportMenuSurface
      open={true}
      role="menu"
      aria-label={t('workspaceContextMenu.chooseAgent')}
      mobileTitle={t('workspaceContextMenu.runAgent')}
      isSubmenu
      onBack={onBack}
      onDismiss={onDismiss}
      ref={submenuRef}
      className="workspace-context-menu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
      data-testid="workspace-context-run-agent-provider-menu"
      placement={{
        type: 'absolute',
        top: style.top as number,
        left: style.left as number,
      }}
      style={{
        maxHeight: style.maxHeight,
      }}
      onMouseEnter={menuHoverHandler(keepSubmenuOpen)}
      onMouseLeave={scheduleSubmenuClose}
    >
      {sortedInstalledProviders.map(provider => (
        <MenuItem
          key={provider}
          icon={<AgentProviderIcon provider={provider} />}
          data-testid={`workspace-context-run-agent-${provider}`}
          onClick={() => {
            openAgentLauncherForProvider(provider)
          }}
        >
          {AGENT_PROVIDER_LABEL[provider]}
        </MenuItem>
      ))}
    </ViewportMenuSurface>
  )
}

export function WorkspaceContextLabelColorSubmenu({
  submenuRef,
  style,
  keepSubmenuOpen,
  scheduleSubmenuClose,
  setSelectedNodeLabelColorOverride,
  closeContextMenu,
  onBack,
}: {
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  keepSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  setSelectedNodeLabelColorOverride: (labelColorOverride: NodeLabelColorOverride) => void
  closeContextMenu: () => void
  onBack: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ViewportMenuSurface
      open={true}
      mobileTitle={t('labelColors.title')}
      isSubmenu
      onBack={onBack}
      onDismiss={closeContextMenu}
      ref={submenuRef}
      className="workspace-context-menu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
      data-testid="workspace-selection-label-color-menu"
      placement={{
        type: 'absolute',
        top: style.top as number,
        left: style.left as number,
      }}
      style={{
        maxHeight: style.maxHeight,
      }}
      onMouseEnter={menuHoverHandler(keepSubmenuOpen)}
      onMouseLeave={scheduleSubmenuClose}
    >
      <button
        type="button"
        data-testid="workspace-selection-label-color-auto-inherit"
        onClick={() => {
          setSelectedNodeLabelColorOverride(null)
          closeContextMenu()
        }}
      >
        <span
          className="workspace-context-menu__icon workspace-label-color-menu__dot workspace-label-color-menu__dot--auto"
          aria-hidden="true"
        />
        <span className="workspace-context-menu__label">{t('labelColors.autoInherit')}</span>
      </button>

      <button
        type="button"
        data-testid="workspace-selection-label-color-none"
        onClick={() => {
          setSelectedNodeLabelColorOverride('none')
          closeContextMenu()
        }}
      >
        <span
          className="workspace-context-menu__icon workspace-label-color-menu__dot workspace-label-color-menu__dot--none"
          aria-hidden="true"
        />
        <span className="workspace-context-menu__label">{t('labelColors.none')}</span>
      </button>

      <div className="workspace-context-menu__separator" />
      <div
        className="workspace-label-color-menu__swatches"
        role="group"
        aria-label={t('labelColors.title')}
      >
        {LABEL_COLORS.map(color => (
          <button
            key={color}
            type="button"
            className="workspace-label-color-menu__swatch"
            data-testid={`workspace-selection-label-color-${color}`}
            aria-label={t(`labelColors.${color}`)}
            title={t(`labelColors.${color}`)}
            onClick={() => {
              setSelectedNodeLabelColorOverride(color)
              closeContextMenu()
            }}
          >
            <span
              className="workspace-label-color-menu__dot"
              data-cove-label-color={color}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </ViewportMenuSurface>
  )
}
