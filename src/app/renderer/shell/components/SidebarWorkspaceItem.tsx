import React from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from '@app/renderer/i18n'
import type { ProjectContextMenuState } from '../types'
import { type SidebarProjectTreeModel, type SidebarSpaceGroupModel } from '../utils/sidebarTree'
import { SidebarAgentItems } from './SidebarAgentItems'
import { SidebarDisclosureIcon } from './SidebarDisclosureIcon'

type SortableWorkspaceItemProps = {
  tree: SidebarProjectTreeModel
  isActive: boolean
  isExpanded: boolean
  collapsedSpaceGroupIds: Record<string, boolean>
  onToggleProject: (workspaceId: string) => void
  onToggleSpaceGroup: (groupKey: string) => void
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSpace: (workspaceId: string, spaceId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
}

function getTreeChildGroups(tree: SidebarProjectTreeModel): SidebarSpaceGroupModel[] {
  return tree.projectRootGroup ? [...tree.spaceGroups, tree.projectRootGroup] : tree.spaceGroups
}

function WorkspaceItemContent({
  tree,
  hasChildren,
  isExpanded,
  onToggleProject,
}: {
  tree: SidebarProjectTreeModel
  hasChildren: boolean
  isExpanded: boolean
  onToggleProject: (workspaceId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const FolderIcon = hasChildren && isExpanded ? FolderOpen : Folder

  return (
    <>
      <span className="workspace-item__headline">
        <FolderIcon className="workspace-item__folder-icon" aria-hidden="true" />
        <span className="workspace-item__name">{tree.workspace.name}</span>
      </span>
      {hasChildren ? (
        <button
          type="button"
          className="workspace-item__tree-toggle"
          data-testid={`workspace-item-toggle-${tree.workspace.id}`}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded ? t('sidebar.collapseProjectTree') : t('sidebar.expandProjectTree')
          }
          onClick={event => {
            event.stopPropagation()
            onToggleProject(tree.workspace.id)
          }}
          onPointerDown={event => {
            event.stopPropagation()
          }}
        >
          <SidebarDisclosureIcon expanded={isExpanded} className="workspace-item__tree-icon" />
        </button>
      ) : null}
    </>
  )
}

function SpaceGroup({
  workspaceId,
  group,
  isActive,
  isExpanded,
  onSelectWorkspace,
  onSelectSpace,
  onToggleSpaceGroup,
  onSelectAgentNode,
  onOpenProjectContextMenu,
}: {
  workspaceId: string
  group: SidebarSpaceGroupModel
  isActive: boolean
  isExpanded: boolean
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSpace: (workspaceId: string, spaceId: string) => void
  onToggleSpaceGroup: (groupKey: string) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isProjectRoot = group.kind === 'project-root'
  const label = isProjectRoot ? t('sidebar.projectRoot') : group.name
  const groupKey = `${workspaceId}:${group.id}`
  const hasAgents = group.agents.length > 0
  const groupClassName = `workspace-space-group ${
    isProjectRoot ? 'workspace-space-group--root' : 'workspace-space-group--space'
  }${hasAgents && isExpanded ? ' workspace-space-group--branched' : ''}`

  return (
    <div className={groupClassName} data-cove-label-color={group.labelColor ?? undefined}>
      <div
        role="button"
        tabIndex={0}
        className={`workspace-space-item${isProjectRoot ? ' workspace-space-item--root' : ' workspace-space-item--space'}${hasAgents ? ' workspace-space-item--has-toggle' : ''}${isActive ? ' workspace-space-item--active' : ''}`}
        data-testid={
          isProjectRoot
            ? `workspace-space-root-${workspaceId}`
            : `workspace-space-item-${workspaceId}-${group.id}`
        }
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
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return
          }
          event.preventDefault()
          if (group.space) {
            onSelectSpace(workspaceId, group.space.id)
            return
          }

          onSelectWorkspace(workspaceId)
        }}
      >
        <SidebarDisclosureIcon
          expanded={isExpanded}
          className="workspace-space-item__rail-icon"
          aria-hidden="true"
        />
        <span className="workspace-space-item__name">{label}</span>
        {hasAgents ? (
          <button
            type="button"
            className="workspace-space-item__toggle"
            aria-label={
              isExpanded ? t('sidebar.collapseProjectTree') : t('sidebar.expandProjectTree')
            }
            aria-expanded={isExpanded}
            onClick={event => {
              event.stopPropagation()
              onToggleSpaceGroup(groupKey)
            }}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              onToggleSpaceGroup(groupKey)
            }}
          >
            <SidebarDisclosureIcon
              expanded={isExpanded}
              className="workspace-space-item__chevron"
            />
          </button>
        ) : (
          <span className="workspace-space-item__toggle-spacer" aria-hidden="true" />
        )}
      </div>

      {hasAgents && isExpanded ? (
        <div className="workspace-space-group__branch">
          <SidebarAgentItems
            workspaceId={workspaceId}
            agentItems={group.agents}
            onSelectAgentNode={onSelectAgentNode}
            onOpenProjectContextMenu={onOpenProjectContextMenu}
          />
        </div>
      ) : null}
    </div>
  )
}

export function SortableWorkspaceItem({
  tree,
  isActive,
  isExpanded,
  collapsedSpaceGroupIds,
  onToggleProject,
  onToggleSpaceGroup,
  onSelectWorkspace,
  onSelectSpace,
  onOpenProjectContextMenu,
  onSelectAgentNode,
}: SortableWorkspaceItemProps): React.JSX.Element {
  const { workspace } = tree
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const childGroups = getTreeChildGroups(tree)
  const hasChildren = childGroups.length > 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`workspace-item-group${isActive ? ' workspace-item-group--active' : ''}`}
    >
      <div className="workspace-item-row">
        <div
          role="button"
          tabIndex={0}
          className={`workspace-item ${isActive ? ' workspace-item--active' : ''}`}
          data-testid={`workspace-item-${workspace.id}`}
          onClick={() => {
            onSelectWorkspace(workspace.id)
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') {
              return
            }
            event.preventDefault()
            onSelectWorkspace(workspace.id)
          }}
          onContextMenu={event => {
            event.preventDefault()
            onOpenProjectContextMenu({
              workspaceId: workspace.id,
              x: event.clientX,
              y: event.clientY,
              target: {
                kind: 'project',
                workspaceId: workspace.id,
              },
            })
          }}
          title={workspace.name}
          {...listeners}
        >
          <WorkspaceItemContent
            tree={tree}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            onToggleProject={onToggleProject}
          />
        </div>
      </div>

      {isExpanded ? (
        <div className="workspace-item__spaces">
          {childGroups.map(group => (
            <SpaceGroup
              key={group.id}
              workspaceId={workspace.id}
              group={group}
              isActive={isActive && group.space?.id === workspace.activeSpaceId}
              isExpanded={collapsedSpaceGroupIds[`${workspace.id}:${group.id}`] !== true}
              onSelectWorkspace={onSelectWorkspace}
              onSelectSpace={onSelectSpace}
              onToggleSpaceGroup={onToggleSpaceGroup}
              onSelectAgentNode={onSelectAgentNode}
              onOpenProjectContextMenu={onOpenProjectContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceItemOverlay({
  tree,
}: {
  tree: SidebarProjectTreeModel
}): React.JSX.Element {
  const childGroups = getTreeChildGroups(tree)

  return (
    <div
      className="workspace-item-group workspace-item-group--drag-overlay"
      data-testid="workspace-item-overlay"
    >
      <div className="workspace-item workspace-item--drag-overlay">
        <WorkspaceItemContent
          tree={tree}
          hasChildren={childGroups.length > 0}
          isExpanded={true}
          onToggleProject={() => undefined}
        />
      </div>
    </div>
  )
}
