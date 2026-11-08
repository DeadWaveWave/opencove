import React from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeOffIcon,
  FocusIcon,
  LayoutIcon,
  MoreIcon,
  PinIcon,
} from '@app/renderer/components/ui/pixelIcons'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from '@app/renderer/i18n'
import { Tooltip } from '@app/renderer/components/ui/Tooltip'
import type { ProjectContextMenuState } from '../types'
import { type SidebarProjectTreeModel, type SidebarSpaceGroupModel } from '../utils/sidebarTree'
import { SidebarAgentItems } from './SidebarAgentItems'
import { createSpaceSortableId, sidebarSortableTransition } from './SidebarDnd'
import { ProjectIcon } from './ProjectIcon'
import { useAppStore } from '../store/useAppStore'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { buildSpaceMinimap, type SpaceMinimapModel } from '../utils/spaceMinimap'
import { SidebarSpaceMinimap } from './SidebarSpaceMinimap'
import { useProjectWorktrees } from '@contexts/workspace/presentation/renderer/worktreeInfo/useProjectWorktrees'
import {
  resolveSpaceBranch,
  type SpaceBranch,
} from '@contexts/workspace/presentation/renderer/worktreeInfo/spaceBranch'

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

function SpaceMeta({
  minimap,
  branch,
}: {
  minimap: SpaceMinimapModel
  branch: SpaceBranch | null
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="workspace-space-item__meta">
      {branch ? (
        // The full name when the card cuts a long branch short; the text is already in the name.
        <Tooltip content={branch.title} describe={false}>
          <span className="workspace-space-item__meta-branch">
            {branch.kind === 'detached'
              ? `${t('worktree.detached')} ${branch.value}`
              : branch.value}
          </span>
        </Tooltip>
      ) : null}
      {minimap.workingCount > 0 ? (
        <span className="workspace-space-item__meta-working">
          {t('sidebar.space.working', { count: minimap.workingCount })}
        </span>
      ) : null}
      {minimap.waitingCount > 0 ? (
        <span className="workspace-space-item__meta-waiting">
          {t('sidebar.space.waiting', { count: minimap.waitingCount })}
        </span>
      ) : null}
      <span>{t('sidebar.space.windows', { count: minimap.windows.length })}</span>
    </span>
  )
}

function SpaceGroup({
  workspace,
  workspaceId,
  group,
  isActive,
  currentNodeId,
  isExpanded,
  branch,
  onSelectProjectCanvas,
  onSelectSpace,
  onToggleSpaceGroup,
  onSelectAgentNode,
  onOpenProjectContextMenu,
  onRestoreSidebarItem,
}: NavigationProps & {
  workspace: WorkspaceState
  workspaceId: string
  group: SidebarSpaceGroupModel
  isActive: boolean
  currentNodeId: string | null
  isExpanded: boolean
  onToggleSpaceGroup: (groupKey: string) => void
  /** The branch of the worktree the Space works in, if it has one of its own. */
  branch: SpaceBranch | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const isRoot = group.kind === 'project-root'
  const label = isRoot ? t('sidebar.rootCanvas') : group.name
  const hasAgents = group.agents.length > 0
  const isPinned = group.space?.pinned === true
  const minimap = group.space ? buildSpaceMinimap(workspace, group.space) : null
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
      <div
        data-cove-part="sidebar-space"
        className={`workspace-space-item${isRoot ? ' workspace-space-item--root' : ''}${minimap ? ' workspace-space-item--card' : ''}`}
      >
        {minimap && group.space ? (
          <SidebarSpaceMinimap
            model={minimap}
            testId={`workspace-space-minimap-${workspaceId}-${group.id}`}
            onSelectWindow={nodeId => onSelectAgentNode(workspaceId, nodeId)}
            onSelectSpace={() => onSelectSpace(workspaceId, group.id)}
          />
        ) : null}
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
          {minimap ? null : isRoot ? <LayoutIcon size={18} /> : <FocusIcon size={18} />}
          <span className="workspace-space-item__name">{label}</span>
          {minimap ? <SpaceMeta minimap={minimap} branch={branch} /> : null}
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
            <EyeOffIcon size={18} />
          </button>
        ) : !isRoot ? (
          <>
            {isPinned ? (
              <button
                type="button"
                className="workspace-sidebar__more workspace-space-item__pin"
                data-testid={`workspace-space-unpin-${workspaceId}-${group.id}`}
                aria-label={t('projectContextMenu.unpinSpace')}
                title={t('projectContextMenu.unpinSpace')}
                onClick={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (group.space) {
                    useAppStore
                      .getState()
                      .setWorkspaceSpacePinned(workspaceId, group.space.id, false)
                  }
                }}
              >
                <PinIcon size={18} />
              </button>
            ) : null}
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
              <MoreIcon size={18} />
            </button>
          </>
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
            {isExpanded ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
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
  const rootAgents = tree.projectRootGroup.agents
  // The same worktree listing the canvas's Space frames read (one listing per repository).
  const worktrees = useProjectWorktrees(workspace)

  return (
    <div
      className="workspace-item__spaces"
      data-testid={`workspace-project-navigation-${workspace.id}`}
    >
      {rootAgents.length > 0 ? (
        <SidebarAgentItems
          workspaceId={workspace.id}
          groupId={rootAgents.length > 1 ? tree.projectRootGroup.id : null}
          agentItems={rootAgents}
          currentNodeId={isActive ? currentNodeId : null}
          onSelectAgentNode={navigationProps.onSelectAgentNode}
          onOpenProjectContextMenu={navigationProps.onOpenProjectContextMenu}
          onRestoreSidebarItem={navigationProps.onRestoreSidebarItem}
        />
      ) : null}
      <SortableContext
        items={tree.spaceGroups.map(group => createSpaceSortableId(workspace.id, group.id))}
        strategy={verticalListSortingStrategy}
      >
        {tree.spaceGroups.map(group => (
          <SpaceGroup
            key={group.id}
            workspace={workspace}
            branch={
              group.space
                ? resolveSpaceBranch(worktrees, workspace.path, group.space.directoryPath)
                : null
            }
            workspaceId={workspace.id}
            group={group}
            isActive={isActive && !currentNodeId && group.id === workspace.activeSpaceId}
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
          {group.kind === 'project-root' ? <LayoutIcon size={18} /> : <FocusIcon size={18} />}
          <span className="workspace-space-item__name">
            {group.kind === 'project-root' ? t('sidebar.rootCanvas') : group.name}
          </span>
        </span>
      </div>
    </div>
  )
}
