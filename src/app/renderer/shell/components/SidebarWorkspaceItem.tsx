import React from 'react'
import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  LayoutDashboard,
  MoreHorizontal,
  Scan,
} from 'lucide-react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from '@app/renderer/i18n'
import type { ProjectContextMenuState } from '../types'
import { type SidebarProjectTreeModel, type SidebarSpaceGroupModel } from '../utils/sidebarTree'
import { SidebarAgentItems } from './SidebarAgentItems'
import { createSpaceSortableId, sidebarSortableTransition } from './SidebarDnd'
import { ProjectIcon } from './ProjectIcon'

export function getTreeChildGroups(tree: SidebarProjectTreeModel): SidebarSpaceGroupModel[] {
  return [tree.projectRootGroup, ...tree.spaceGroups]
}

type NavigationProps = {
  onSelectProjectCanvas: (workspaceId: string) => void
  onSelectSpace: (workspaceId: string, spaceId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onRestoreSidebarItem?: (kind: 'space' | 'agent', id: string, name: string) => void
}

function SpaceGroup({
  workspaceId,
  group,
  isActive,
  currentNodeId,
  isExpanded,
  onSelectProjectCanvas,
  onSelectSpace,
  onToggleSpaceGroup,
  onSelectAgentNode,
  onOpenProjectContextMenu,
  onRestoreSidebarItem,
}: NavigationProps & {
  workspaceId: string
  group: SidebarSpaceGroupModel
  isActive: boolean
  currentNodeId: string | null
  isExpanded: boolean
  onToggleSpaceGroup: (groupKey: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isRoot = group.kind === 'project-root'
  const label = isRoot ? t('sidebar.rootCanvas') : group.name
  const hasAgents = group.agents.length > 0
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: isRoot ? `${workspaceId}:${group.id}` : createSpaceSortableId(workspaceId, group.id),
    disabled: isRoot,
    transition: sidebarSortableTransition,
    data: isRoot ? undefined : { kind: 'space', workspaceId, spaceId: group.id },
  })
  const openMenu = (x: number, y: number): void => {
    if (!group.space) {
      return
    }
    onOpenProjectContextMenu({
      workspaceId,
      x,
      y,
      target: { kind: 'space', workspaceId, spaceId: group.space.id },
    })
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className={`workspace-space-group workspace-space-group--${isRoot ? 'root' : 'space'}${isDragging ? ' workspace-space-group--dragging' : ''}`}
      data-sidebar-hidden={group.sidebarHidden || undefined}
      data-cove-label-color={group.labelColor ?? undefined}
    >
      <div className={`workspace-space-item${isRoot ? ' workspace-space-item--root' : ''}`}>
        <button
          type="button"
          className="workspace-space-item__select"
          data-testid={
            isRoot
              ? `workspace-space-root-${workspaceId}`
              : `workspace-space-item-${workspaceId}-${group.id}`
          }
          aria-current={isActive ? 'location' : undefined}
          title={label}
          {...(!isRoot ? attributes : {})}
          {...(!isRoot ? listeners : {})}
          onContextMenu={event => {
            event.preventDefault()
            openMenu(event.clientX, event.clientY)
          }}
          onClick={() =>
            group.space
              ? onSelectSpace(workspaceId, group.space.id)
              : onSelectProjectCanvas(workspaceId)
          }
        >
          {isRoot ? (
            <LayoutDashboard size={14} aria-hidden="true" />
          ) : (
            <Scan size={16} aria-hidden="true" />
          )}
          <span className="workspace-space-item__name">{label}</span>
        </button>
        {!isRoot && group.sidebarHidden ? (
          <button
            type="button"
            className="workspace-sidebar__more workspace-sidebar__restore"
            data-testid={`workspace-space-restore-${workspaceId}-${group.id}`}
            aria-label={`${t('sidebar.restore')}: ${label}`}
            title={t('sidebar.restore')}
            onClick={() => onRestoreSidebarItem?.('space', group.id, label)}
          >
            <EyeOff size={14} aria-hidden="true" />
          </button>
        ) : !isRoot ? (
          <button
            type="button"
            className="workspace-sidebar__more workspace-sidebar__row-more"
            data-testid={`workspace-space-more-${workspaceId}-${group.id}`}
            aria-label={`${t('sidebar.spaceMore')}: ${label}`}
            title={t('sidebar.spaceMore')}
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              openMenu(rect.right, rect.bottom)
            }}
          >
            <MoreHorizontal size={14} aria-hidden="true" />
          </button>
        ) : null}
        {hasAgents ? (
          <button
            type="button"
            className="workspace-space-item__toggle"
            data-testid={`workspace-space-toggle-${workspaceId}-${group.id}`}
            aria-label={
              isExpanded ? t('sidebar.collapseProjectTree') : t('sidebar.expandProjectTree')
            }
            aria-expanded={isExpanded}
            onClick={() => onToggleSpaceGroup(`${workspaceId}:${group.id}`)}
          >
            {isExpanded ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
      {hasAgents && isExpanded ? (
        <div className="workspace-space-group__branch">
          <SidebarAgentItems
            workspaceId={workspaceId}
            groupId={group.agents.length > 1 ? group.id : null}
            agentItems={group.agents}
            currentNodeId={currentNodeId}
            onSelectAgentNode={onSelectAgentNode}
            onOpenProjectContextMenu={onOpenProjectContextMenu}
            onRestoreSidebarItem={onRestoreSidebarItem}
          />
        </div>
      ) : null}
    </div>
  )
}

export function SidebarWorkspaceNavigation({
  tree,
  isActive,
  currentNodeId = null,
  collapsedSpaceGroupIds,
  onToggleSpaceGroup,
  ...navigationProps
}: NavigationProps & {
  tree: SidebarProjectTreeModel
  isActive: boolean
  currentNodeId?: string | null
  collapsedSpaceGroupIds: Record<string, boolean>
  onToggleSpaceGroup: (groupKey: string) => void
}): React.JSX.Element {
  const { workspace } = tree

  return (
    <div
      className="workspace-item__spaces"
      data-testid={`workspace-project-navigation-${workspace.id}`}
    >
      <SortableContext
        items={tree.spaceGroups.map(group => createSpaceSortableId(workspace.id, group.id))}
        strategy={verticalListSortingStrategy}
      >
        {getTreeChildGroups(tree).map(group => (
          <SpaceGroup
            key={group.id}
            workspaceId={workspace.id}
            group={group}
            isActive={
              isActive &&
              !currentNodeId &&
              (group.kind === 'project-root'
                ? !workspace.activeSpaceId
                : group.id === workspace.activeSpaceId)
            }
            currentNodeId={isActive ? currentNodeId : null}
            isExpanded={collapsedSpaceGroupIds[`${workspace.id}:${group.id}`] !== true}
            onToggleSpaceGroup={onToggleSpaceGroup}
            {...navigationProps}
          />
        ))}
      </SortableContext>
    </div>
  )
}

export function WorkspaceItemOverlay({
  tree,
}: {
  tree: SidebarProjectTreeModel
}): React.JSX.Element {
  return (
    <div
      className="workspace-project-rail__drag-overlay"
      data-testid="workspace-sidebar-drag-overlay"
      data-cove-sidebar-drag-kind="project"
    >
      <ProjectIcon
        iconId={tree.workspace.iconId}
        isExpanded
        className="workspace-item__folder-icon"
      />
      <span>{tree.workspace.name}</span>
    </div>
  )
}

export function SpaceItemOverlay({
  group,
}: {
  group: SidebarSpaceGroupModel
  isExpanded?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="workspace-space-group workspace-space-group--drag-overlay"
      data-testid="workspace-sidebar-drag-overlay"
      data-cove-label-color={group.labelColor ?? undefined}
      data-cove-sidebar-drag-kind="space"
    >
      <div className="workspace-space-item workspace-space-item--drag-overlay">
        <span className="workspace-space-item__select">
          {group.kind === 'project-root' ? (
            <LayoutDashboard size={14} aria-hidden="true" />
          ) : (
            <Scan size={16} aria-hidden="true" />
          )}
          <span className="workspace-space-item__name">
            {group.kind === 'project-root' ? t('sidebar.rootCanvas') : group.name}
          </span>
        </span>
      </div>
    </div>
  )
}
