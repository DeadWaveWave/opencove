import React, { useCallback, useState } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from '@app/renderer/i18n'
import type { PersistNotice, ProjectContextMenuState } from '../types'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { SidebarAgentItems } from './SidebarAgentItems'
import { SidebarDisclosureIcon } from './SidebarDisclosureIcon'
import { SidebarRail } from './SidebarRail'
import { SidebarToolbar } from './SidebarToolbar'
import {
  buildSidebarProjectTree,
  type SidebarProjectTreeModel,
  type SidebarSpaceGroupModel,
} from '../utils/sidebarTree'

export type SidebarVariant = 'docked' | 'rail' | 'peek'

type SidebarProps = {
  variant?: SidebarVariant
  isPinned?: boolean
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  persistNotice: PersistNotice | null
  onTogglePinned?: () => void
  onAddProject?: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSpace: (workspaceId: string, spaceId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onReorderWorkspaces: (activeId: string, overId: string) => void
  onPointerEnter?: React.PointerEventHandler<HTMLElement>
  onPointerLeave?: React.PointerEventHandler<HTMLElement>
}

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
        className={`workspace-space-item${isProjectRoot ? ' workspace-space-item--root' : ' workspace-space-item--space'}${isActive ? ' workspace-space-item--active' : ''}`}
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

function SortableWorkspaceItem({
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

function WorkspaceItemOverlay({ tree }: { tree: SidebarProjectTreeModel }): React.JSX.Element {
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

export function Sidebar({
  variant = 'docked',
  isPinned = variant !== 'rail',
  workspaces,
  activeWorkspaceId,
  persistNotice,
  onTogglePinned = () => undefined,
  onAddProject = () => undefined,
  onSelectWorkspace,
  onSelectSpace,
  onOpenProjectContextMenu,
  onSelectAgentNode,
  onReorderWorkspaces,
  onPointerEnter,
  onPointerLeave,
}: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()
  const trees = workspaces.map(buildSidebarProjectTree)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({})
  const [collapsedSpaceGroupIds, setCollapsedSpaceGroupIds] = useState<Record<string, boolean>>({})

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const nextActiveId = String(event.active.id)
      const nextOverId = event.over?.id

      setActiveId(null)

      if (nextOverId === null || nextOverId === undefined) {
        return
      }

      const overId = String(nextOverId)
      if (overId === nextActiveId) {
        return
      }

      onReorderWorkspaces(nextActiveId, overId)
    },
    [onReorderWorkspaces],
  )

  const handleToggleProject = useCallback((workspaceId: string): void => {
    setCollapsedWorkspaceIds(prev => ({
      ...prev,
      [workspaceId]: prev[workspaceId] !== true,
    }))
  }, [])

  const handleToggleSpaceGroup = useCallback((groupKey: string): void => {
    setCollapsedSpaceGroupIds(prev => ({
      ...prev,
      [groupKey]: prev[groupKey] !== true,
    }))
  }, [])

  const activeTree =
    activeId === null ? null : (trees.find(tree => tree.workspace.id === activeId) ?? null)
  const className = `workspace-sidebar workspace-sidebar--${variant}`

  if (variant === 'rail') {
    return (
      <aside
        className={className}
        data-testid="workspace-sidebar"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <SidebarToolbar
          isPinned={isPinned}
          showAddProject={false}
          onTogglePinned={onTogglePinned}
          onAddProject={onAddProject}
        />
        <SidebarRail
          trees={trees}
          activeWorkspaceId={activeWorkspaceId}
          collapsedWorkspaceIds={collapsedWorkspaceIds}
          collapsedSpaceGroupIds={collapsedSpaceGroupIds}
          onSelectWorkspace={onSelectWorkspace}
          onSelectSpace={onSelectSpace}
          onOpenProjectContextMenu={onOpenProjectContextMenu}
          onSelectAgentNode={onSelectAgentNode}
        />
      </aside>
    )
  }

  return (
    <aside
      className={className}
      data-testid="workspace-sidebar"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <SidebarToolbar
        isPinned={isPinned}
        showAddProject={true}
        onTogglePinned={onTogglePinned}
        onAddProject={onAddProject}
      />
      {persistNotice ? (
        <div
          className={`workspace-sidebar__persist-alert workspace-sidebar__persist-alert--${persistNotice.tone}`}
        >
          <strong>{t('sidebar.persistence')}</strong>
          <span>{persistNotice.message}</span>
        </div>
      ) : null}
      <div className="workspace-sidebar__list">
        {trees.length === 0 ? (
          <p className="workspace-sidebar__empty">{t('sidebar.noProjectYet')}</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={event => setActiveId(String(event.active.id))}
            onDragCancel={() => setActiveId(null)}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={trees.map(tree => tree.workspace.id)}
              strategy={verticalListSortingStrategy}
            >
              {trees.map(tree => (
                <SortableWorkspaceItem
                  key={tree.workspace.id}
                  tree={tree}
                  isActive={tree.workspace.id === activeWorkspaceId}
                  isExpanded={collapsedWorkspaceIds[tree.workspace.id] !== true}
                  collapsedSpaceGroupIds={collapsedSpaceGroupIds}
                  onToggleProject={handleToggleProject}
                  onToggleSpaceGroup={handleToggleSpaceGroup}
                  onSelectWorkspace={onSelectWorkspace}
                  onSelectSpace={onSelectSpace}
                  onOpenProjectContextMenu={onOpenProjectContextMenu}
                  onSelectAgentNode={onSelectAgentNode}
                />
              ))}
            </SortableContext>

            <DragOverlay>
              {activeTree ? <WorkspaceItemOverlay tree={activeTree} /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </aside>
  )
}
