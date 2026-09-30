import React from 'react'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { menuHoverHandler } from '@app/renderer/components/menuHoverHandler'
import {
  Check,
  ChevronRight,
  FileText,
  Globe,
  LayoutGrid,
  ListTodo,
  LoaderCircle,
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

function renderMark(checked: boolean): React.JSX.Element {
  return checked ? (
    <Check className="workspace-context-menu__mark" aria-hidden="true" />
  ) : (
    <span className="workspace-context-menu__mark" aria-hidden="true" />
  )
}

export function WorkspaceContextPaneMenuContent({
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
      <button
        type="button"
        data-testid="workspace-context-new-terminal"
        onClick={() => {
          void createTerminalNode()
        }}
      >
        <Terminal className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('workspaceContextMenu.newTerminal')}
        </span>
      </button>
      <button
        type="button"
        data-testid="workspace-context-new-note"
        onClick={() => {
          createNoteNodeFromContextMenu()
        }}
      >
        <FileText className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('workspaceContextMenu.newNote')}</span>
      </button>
      {websiteWindowsEnabled ? (
        <button
          type="button"
          data-testid="workspace-context-new-website"
          onClick={() => {
            createWebsiteNodeFromContextMenu()
          }}
        >
          <Globe className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('workspaceContextMenu.newWebsite')}
          </span>
        </button>
      ) : null}
      {localPlugins.map(plugin => (
        <button
          key={plugin.id}
          type="button"
          data-testid={`workspace-context-new-plugin-${plugin.id}`}
          onClick={() => createPluginNodeFromContextMenu(plugin.id)}
        >
          <PluginIcon pluginId={plugin.id} className="workspace-context-menu__icon" />
          <span className="workspace-context-menu__label">{plugin.displayName}</span>
        </button>
      ))}
      <button
        type="button"
        data-testid="workspace-context-new-task"
        onClick={() => {
          openTaskCreator()
        }}
      >
        <ListTodo className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('workspaceContextMenu.newTask')}</span>
      </button>

      <WorkspaceContextRoleMenuItems
        roleButtonRef={roleButtonRef}
        openProjectRolesSubmenu={openProjectRolesSubmenu}
        isProjectRolesSubmenuOpen={isProjectRolesSubmenuOpen}
      />

      <div className="workspace-context-menu__split">
        <button
          type="button"
          data-testid="workspace-context-run-default-agent"
          className="workspace-context-menu__split-main"
          onClick={openAgentLauncher}
        >
          <Play className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('workspaceContextMenu.runAgent')}
          </span>
        </button>
        <button
          ref={agentProviderToggleRef}
          type="button"
          data-testid="workspace-context-run-agent-provider-toggle"
          className="workspace-context-menu__split-toggle"
          aria-label={t('workspaceContextMenu.runAgent')}
          aria-haspopup="menu"
          aria-expanded={isAgentProviderSubmenuOpen}
          onMouseEnter={menuHoverHandler(openAgentProviderSubmenu)}
          onClick={openAgentProviderSubmenu}
        >
          {isLoadingInstalledProviders ? (
            <LoaderCircle
              className="workspace-context-menu__icon workspace-context-menu__spinner"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className={`workspace-context-menu__icon workspace-context-menu__chevron ${
                isAgentProviderSubmenuOpen ? 'workspace-context-menu__chevron--open' : ''
              }`}
              aria-hidden="true"
            />
          )}
        </button>
      </div>
      {canCreateSpace ? (
        <button
          type="button"
          data-testid="workspace-context-create-space"
          onClick={createSpaceFromContextMenu}
        >
          <Scan className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('workspaceContextMenu.createSpace')}
          </span>
        </button>
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

      <button
        type="button"
        data-testid="workspace-context-arrange"
        disabled={!canArrangeCurrentScope}
        onClick={commitArrangeAndClose}
      >
        <LayoutGrid className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('workspaceContextMenu.arrange')}</span>
      </button>

      <button
        ref={arrangeByButtonRef}
        type="button"
        data-testid="workspace-context-arrange-by"
        aria-haspopup="menu"
        aria-expanded={isArrangeSubmenuOpen}
        onMouseEnter={menuHoverHandler(openArrangeSubmenu)}
        onClick={openArrangeSubmenu}
      >
        <SlidersHorizontal className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('workspaceContextMenu.arrangeBy')}</span>
        <ChevronRight
          className={`workspace-context-menu__icon workspace-context-menu__chevron ${
            isArrangeSubmenuOpen ? 'workspace-context-menu__chevron--open' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      <button
        type="button"
        className="workspace-context-menu__checkmark-only"
        data-testid="workspace-context-magnetic-snapping"
        aria-pressed={magneticSnappingEnabled}
        onClick={onToggleMagneticSnapping}
      >
        <Magnet className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.magneticSnapping')}
        </span>
        {renderMark(magneticSnappingEnabled)}
      </button>
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
        <button
          key={provider}
          type="button"
          data-testid={`workspace-context-run-agent-${provider}`}
          onClick={() => {
            openAgentLauncherForProvider(provider)
          }}
        >
          <AgentProviderIcon provider={provider} className="workspace-context-menu__icon" />
          <span className="workspace-context-menu__label">{AGENT_PROVIDER_LABEL[provider]}</span>
        </button>
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
