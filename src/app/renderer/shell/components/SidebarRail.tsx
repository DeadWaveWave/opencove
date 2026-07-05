import React from 'react'
import { Folder } from 'lucide-react'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useTranslation } from '@app/renderer/i18n'
import type { ProjectContextMenuState } from '../types'
import type { SidebarProjectTreeModel, SidebarSpaceGroupModel } from '../utils/sidebarTree'
import { SidebarDisclosureIcon } from './SidebarDisclosureIcon'

function RailAgentButton({
  workspaceId,
  agent,
  onSelectAgentNode,
  onOpenProjectContextMenu,
}: {
  workspaceId: string
  agent: SidebarSpaceGroupModel['agents'][number]
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const provider = agent.node.data.agent?.provider ?? null
  const sidebarAgentStatusText =
    agent.status === 'working' ? t('sidebar.status.working') : t('sidebar.status.standby')

  return (
    <button
      type="button"
      className="workspace-rail-agent"
      data-testid={`workspace-rail-agent-${workspaceId}-${agent.node.id}`}
      data-cove-label-color={agent.effectiveLabelColor ?? undefined}
      title={`${agent.displayTitle} · ${sidebarAgentStatusText}`}
      onClick={() => onSelectAgentNode(workspaceId, agent.node.id)}
      onContextMenu={event => {
        event.preventDefault()
        onOpenProjectContextMenu({
          workspaceId,
          x: event.clientX,
          y: event.clientY,
          target: {
            kind: 'agent',
            workspaceId,
            nodeId: agent.node.id,
          },
        })
      }}
    >
      <span className="workspace-rail-agent__icon-wrap">
        {provider ? (
          <AgentProviderIcon
            provider={provider}
            labelColor={agent.effectiveLabelColor}
            className={`workspace-rail-agent__provider workspace-agent-item__provider--status workspace-agent-item__provider--status-${agent.status}`}
          />
        ) : (
          <span
            className={`workspace-rail-agent__fallback workspace-agent-item__provider--status workspace-agent-item__provider--status-${agent.status}`}
            aria-hidden="true"
          />
        )}
        <span className="workspace-agent-item__status-label">{sidebarAgentStatusText}</span>
      </span>
    </button>
  )
}

function RailSpaceGroup({
  workspaceId,
  group,
  isActive,
  isExpanded,
  onSelectWorkspace,
  onSelectSpace,
  onSelectAgentNode,
  onOpenProjectContextMenu,
}: {
  workspaceId: string
  group: SidebarSpaceGroupModel
  isActive: boolean
  isExpanded: boolean
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSpace: (workspaceId: string, spaceId: string) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isProjectRoot = group.kind === 'project-root'
  const label = isProjectRoot ? t('sidebar.projectRoot') : group.name
  const hasVisibleAgents = group.agents.length > 0 && isExpanded
  const groupClassName = [
    'workspace-rail-space-group',
    isProjectRoot ? 'workspace-rail-space-group--root' : 'workspace-rail-space-group--space',
    hasVisibleAgents ? 'workspace-rail-space-group--branched' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={groupClassName} data-cove-label-color={group.labelColor ?? undefined}>
      <button
        type="button"
        className={`workspace-rail-space${isProjectRoot ? ' workspace-rail-space--root' : ' workspace-rail-space--space'}${isActive ? ' workspace-rail-space--active' : ''}`}
        data-testid={
          isProjectRoot
            ? `workspace-rail-space-root-${workspaceId}`
            : `workspace-rail-space-${workspaceId}-${group.id}`
        }
        aria-expanded={group.agents.length > 0 ? isExpanded : undefined}
        data-cove-label-color={group.labelColor ?? undefined}
        title={label}
        onContextMenu={event => {
          event.preventDefault()
          if (!group.space) {
            return
          }
          onOpenProjectContextMenu({
            workspaceId,
            x: event.clientX,
            y: event.clientY,
            target: {
              kind: 'space',
              workspaceId,
              spaceId: group.space.id,
            },
          })
        }}
        onClick={() => {
          if (group.space) {
            onSelectSpace(workspaceId, group.space.id)
            return
          }

          onSelectWorkspace(workspaceId)
        }}
      >
        <SidebarDisclosureIcon expanded={isExpanded} className="workspace-rail-space__icon" />
      </button>

      {hasVisibleAgents ? (
        <div className="workspace-rail-space-group__agents">
          {group.agents.map(agent => (
            <RailAgentButton
              key={agent.node.id}
              workspaceId={workspaceId}
              agent={agent}
              onSelectAgentNode={onSelectAgentNode}
              onOpenProjectContextMenu={onOpenProjectContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function SidebarRail({
  trees,
  activeWorkspaceId,
  collapsedWorkspaceIds,
  collapsedSpaceGroupIds,
  onSelectWorkspace,
  onSelectSpace,
  onOpenProjectContextMenu,
  onSelectAgentNode,
}: {
  trees: SidebarProjectTreeModel[]
  activeWorkspaceId: string | null
  collapsedWorkspaceIds: Record<string, boolean>
  collapsedSpaceGroupIds: Record<string, boolean>
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSpace: (workspaceId: string, spaceId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
}): React.JSX.Element {
  return (
    <div className="workspace-sidebar-rail__list">
      {trees.map(tree => {
        const isActive = tree.workspace.id === activeWorkspaceId
        const isExpanded = collapsedWorkspaceIds[tree.workspace.id] !== true
        const childGroups = tree.projectRootGroup
          ? [...tree.spaceGroups, tree.projectRootGroup]
          : tree.spaceGroups

        return (
          <div
            key={tree.workspace.id}
            className={`workspace-rail-project-group${isActive ? ' workspace-rail-project-group--active' : ''}`}
          >
            <button
              type="button"
              className={`workspace-rail-project${isActive ? ' workspace-rail-project--active' : ''}`}
              data-testid={`workspace-rail-project-${tree.workspace.id}`}
              title={tree.workspace.name}
              onClick={() => onSelectWorkspace(tree.workspace.id)}
              onContextMenu={event => {
                event.preventDefault()
                onOpenProjectContextMenu({
                  workspaceId: tree.workspace.id,
                  x: event.clientX,
                  y: event.clientY,
                  target: {
                    kind: 'project',
                    workspaceId: tree.workspace.id,
                  },
                })
              }}
            >
              <Folder aria-hidden="true" />
            </button>

            {isExpanded
              ? childGroups.map(group => (
                  <RailSpaceGroup
                    key={group.id}
                    workspaceId={tree.workspace.id}
                    group={group}
                    isActive={isActive && group.space?.id === tree.workspace.activeSpaceId}
                    isExpanded={collapsedSpaceGroupIds[`${tree.workspace.id}:${group.id}`] !== true}
                    onSelectWorkspace={onSelectWorkspace}
                    onSelectSpace={onSelectSpace}
                    onSelectAgentNode={onSelectAgentNode}
                    onOpenProjectContextMenu={onOpenProjectContextMenu}
                  />
                ))
              : null}
          </div>
        )
      })}
    </div>
  )
}
