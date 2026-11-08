import { useMemo } from 'react'
import {
  FocusIcon,
  FolderPlusIcon,
  PackageIcon,
  RobotIcon,
  SearchIcon,
  SettingsIcon,
  ShowcaseIcon,
  SidebarCloseIcon,
  SidebarOpenIcon,
} from '@app/renderer/components/ui/pixelIcons'
import { useTranslation } from '@app/renderer/i18n'
import {
  describeKeyChord,
  resolveCommandKeybinding,
  type AppCommandId,
} from '@contexts/settings/domain/keybindings'
import { usePluginCommands } from '@contexts/plugins/presentation/renderer/usePluginCommands'
import { PluginIcon } from '@contexts/plugins/presentation/renderer/PluginIcon'
import { NodeKindIcon } from '@contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'
import { resolveWindowKindFamily } from '@contexts/workspace/presentation/renderer/utils/windowKindFamily'
import { resolveAgentPresentationProvider } from '@contexts/workspace/presentation/renderer/utils/agentPresentation'
import { KindTile } from '@app/renderer/components/ui/KindTile'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useWorkspaceMountDetails } from '../hooks/useWorkspaceMountSummaries'
import { useAgentWaitingSinceStore, useMinuteClock } from '../hooks/useAgentWaitingSince'
import { useAppStore } from '../store/useAppStore'
import { setShowcaseMode, useShowcaseMode } from '../showcase/showcaseMode'
import { summarizeAgentActivity } from '../utils/agentActivitySummary'
import { buildSidebarAgentItems } from '../utils/sidebarAgents'
import { describeWaitDuration, resolveWaitDuration } from '../utils/waitDuration'
import { ProjectIcon } from './ProjectIcon'
import type { CommandCenterItem, CommandCenterSection } from './commandCenterModel'

export interface CommandCenterActions {
  onOpenSettings: () => void
  onOpenWorkspaceSearch: () => void
  onOpenSpaceArchives: () => void
  onTogglePrimarySidebar: () => void
  onAddWorkspace: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSpace: (spaceId: string | null) => void
  onSelectNode: (workspaceId: string, nodeId: string) => void
}

/**
 * One searchable list: agents waiting for you (pinned), the current project's windows, its
 * Spaces, every project, then commands with their shortcuts.
 */
export function useCommandCenterSections({
  isOpen,
  activeWorkspace,
  workspaces,
  isPrimarySidebarCollapsed,
  actions,
}: {
  isOpen: boolean
  activeWorkspace: WorkspaceState | null
  workspaces: WorkspaceState[]
  isPrimarySidebarCollapsed: boolean
  actions: CommandCenterActions
}): CommandCenterSection[] {
  const { t } = useTranslation()
  const showcase = useShowcaseMode()
  const mountDetails = useWorkspaceMountDetails({ workspaces })
  const keybindings = useAppStore(state => state.agentSettings.keybindings)
  const observations = useAgentWaitingSinceStore(state => state.observations)
  const waitingAgents = useMemo(() => summarizeAgentActivity(workspaces).waiting, [workspaces])
  const nowMs = useMinuteClock(isOpen && waitingAgents.length > 0)
  const activeSpace =
    activeWorkspace?.spaces.find(space => space.id === activeWorkspace.activeSpaceId) ?? null
  const pluginCommands = usePluginCommands(
    {
      surface: 'commandCenter',
      ...(activeWorkspace ? { projectId: activeWorkspace.id } : {}),
      ...(activeSpace ? { spaceId: activeSpace.id } : {}),
    },
    isOpen,
  )

  return useMemo<CommandCenterSection[]>(() => {
    const platform = window.opencoveApi?.meta?.platform
    const shortcutFor = (commandId: AppCommandId) =>
      describeKeyChord(
        platform,
        resolveCommandKeybinding({ commandId, overrides: keybindings, platform }),
      )

    const needsYou: CommandCenterItem[] = waitingAgents.map(agent => ({
      id: `needs-you:${agent.workspaceId}:${agent.nodeId}`,
      title: agent.title,
      subtitle: `${agent.projectName} · ${agent.spaceName ?? t('sidebar.rootCanvas')}`,
      status: {
        tone: 'waiting',
        label: describeWaitDuration(
          t,
          resolveWaitDuration(observations.get(agent.nodeId)?.waitingSinceMs ?? null, nowMs),
        ),
      },
      tone: 'waiting',
      icon: (
        <KindTile kind="ai">
          <RobotIcon />
        </KindTile>
      ),
      onSelect: () => actions.onSelectNode(agent.workspaceId, agent.nodeId),
    }))

    const waitingNodeIds = new Set(waitingAgents.map(agent => agent.nodeId))
    const agentItems = new Map(
      activeWorkspace
        ? buildSidebarAgentItems(activeWorkspace).map(item => [item.node.id, item])
        : [],
    )
    const windows: CommandCenterItem[] = activeWorkspace
      ? activeWorkspace.nodes
          .filter(node => !waitingNodeIds.has(node.id))
          .map(node => {
            const space = activeWorkspace.spaces.find(item => item.nodeIds.includes(node.id))
            const spaceName = space?.name ?? t('sidebar.rootCanvas')
            const agent = agentItems.get(node.id)
            const provider = resolveAgentPresentationProvider(node.data)
            return {
              id: `window:${node.id}`,
              title: agent?.displayTitle || node.data.title || node.data.kind,
              keywords: spaceName,
              // A working agent shows its state where other windows name their Space.
              ...(agent?.status === 'working'
                ? { status: { tone: 'working' as const, label: t('sidebar.status.working') } }
                : { trailing: spaceName }),
              icon: (
                <KindTile kind={resolveWindowKindFamily(node.data)}>
                  <NodeKindIcon
                    kind={provider ? 'agent' : node.data.kind}
                    provider={provider}
                    pluginId={node.data.plugin?.pluginId}
                  />
                </KindTile>
              ),
              onSelect: () => actions.onSelectNode(activeWorkspace.id, node.id),
            }
          })
      : []

    const spaces: CommandCenterItem[] =
      activeWorkspace?.spaces
        .filter(space => !space.parentSpaceId)
        .map(space => ({
          id: `space:${space.id}`,
          title: space.name,
          icon: <FocusIcon size={18} />,
          labelColor: space.labelColor,
          isCurrent: space.id === activeSpace?.id,
          onSelect: () => actions.onSelectSpace(space.id),
        })) ?? []

    const projects: CommandCenterItem[] = workspaces.map(workspace => ({
      id: `workspace:${workspace.id}`,
      title: workspace.name,
      keywords: [workspace.path, mountDetails[workspace.id]?.summary].filter(Boolean).join(' '),
      icon: (
        <ProjectIcon iconId={workspace.iconId} isExpanded={workspace.id === activeWorkspace?.id} />
      ),
      remoteLabel: mountDetails[workspace.id]?.remote?.displayName,
      isCurrent: workspace.id === activeWorkspace?.id,
      showCurrentMarker: workspace.id === activeWorkspace?.id,
      onSelect: () => actions.onSelectWorkspace(workspace.id),
    }))

    const commands: CommandCenterItem[] = [
      ...(activeWorkspace
        ? [
            {
              id: 'command:workspace-search',
              title: t('commandCenter.commands.searchWorkspace'),
              icon: <SearchIcon size={18} />,
              shortcut: shortcutFor('workspace.search'),
              onSelect: actions.onOpenWorkspaceSearch,
            },
          ]
        : []),
      {
        id: 'command:settings',
        title: t('commandCenter.commands.openSettings'),
        keywords: t('commandCenter.commands.openSettingsHint'),
        icon: <SettingsIcon size={18} />,
        shortcut: shortcutFor('app.openSettings'),
        onSelect: actions.onOpenSettings,
      },
      ...(activeWorkspace
        ? [
            {
              id: 'command:space-archives',
              title: t('commandCenter.commands.spaceArchives'),
              keywords: t('commandCenter.commands.spaceArchivesHint'),
              icon: <PackageIcon size={18} />,
              onSelect: actions.onOpenSpaceArchives,
            },
          ]
        : []),
      {
        id: 'command:toggle-primary-sidebar',
        title: isPrimarySidebarCollapsed
          ? t('commandCenter.commands.showPrimarySidebar')
          : t('commandCenter.commands.hidePrimarySidebar'),
        keywords: t('commandCenter.commands.togglePrimarySidebarHint'),
        icon: isPrimarySidebarCollapsed ? (
          <SidebarOpenIcon size={18} />
        ) : (
          <SidebarCloseIcon size={18} />
        ),
        shortcut: shortcutFor('app.togglePrimarySidebar'),
        onSelect: actions.onTogglePrimarySidebar,
      },
      {
        id: 'command:showcase-mode',
        title: showcase
          ? t('commandCenter.commands.exitShowcase')
          : t('commandCenter.commands.enterShowcase'),
        keywords: t('commandCenter.commands.showcaseHint'),
        icon: <ShowcaseIcon size={18} />,
        onSelect: () => setShowcaseMode(!showcase),
      },
      {
        id: 'command:add-project',
        title: t('commandCenter.commands.addProject'),
        keywords: t('commandCenter.commands.addProjectHint'),
        icon: <FolderPlusIcon size={18} />,
        shortcut: shortcutFor('workspace.addProject'),
        onSelect: actions.onAddWorkspace,
      },
    ]

    const plugins: CommandCenterItem[] = pluginCommands.items.map(item => ({
      id: item.id,
      title: item.title,
      keywords: item.command.description,
      icon: <PluginIcon pluginId={item.plugin.id} />,
      onSelect: () => {
        void pluginCommands.run(item)
      },
    }))

    return [
      {
        id: 'needs-you',
        label: t('commandCenter.sections.needsYou'),
        items: needsYou,
        pinned: true,
      },
      { id: 'windows', label: t('commandCenter.sections.windows'), items: windows },
      { id: 'spaces', label: t('commandCenter.sections.spaces'), items: spaces },
      { id: 'projects', label: t('commandCenter.sections.projects'), items: projects },
      { id: 'commands', label: t('commandCenter.sections.commands'), items: commands },
      { id: 'plugins', label: t('pluginHostExtensions.commands'), items: plugins },
    ]
  }, [
    actions,
    activeSpace?.id,
    activeWorkspace,
    isPrimarySidebarCollapsed,
    keybindings,
    mountDetails,
    nowMs,
    observations,
    pluginCommands,
    showcase,
    t,
    waitingAgents,
    workspaces,
  ])
}
