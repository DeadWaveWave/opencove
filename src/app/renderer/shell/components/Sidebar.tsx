import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useTranslation } from '@app/renderer/i18n'
import type { PersistNotice, ProjectContextMenuState } from '../types'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { SidebarToolbar } from './SidebarToolbar'
import { buildSidebarProjectTree } from '../utils/sidebarTree'
import { SidebarAgentItemOverlay } from './SidebarAgentItems'
import {
  getTreeChildGroups,
  SortableWorkspaceItem,
  SpaceItemOverlay,
  WorkspaceItemOverlay,
} from './SidebarWorkspaceItem'
import {
  canReorderSidebarDragItems,
  readSidebarDragItemData,
  sidebarCollisionDetection,
  sidebarDropAnimation,
  type SidebarDragItemData,
} from './SidebarDnd'
import { useSidebarListScroll } from './useSidebarListScroll'

export type SidebarVariant = 'docked' | 'rail' | 'peek'
type SidebarTransition = 'collapsing' | 'expanding' | null

const sidebarTransitionSettleMs = 260

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
  onReorderWorkspaceRootSpaces?: (
    workspaceId: string,
    activeSpaceId: string,
    overSpaceId: string,
  ) => void
  onReorderWorkspaceSidebarAgents?: (
    workspaceId: string,
    activeNodeId: string,
    overNodeId: string,
  ) => void
  onPointerEnter?: React.PointerEventHandler<HTMLElement>
  onPointerLeave?: React.PointerEventHandler<HTMLElement>
}

type ActiveSidebarDragItem = {
  id: string
  data: SidebarDragItemData
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
  onReorderWorkspaceRootSpaces = () => undefined,
  onReorderWorkspaceSidebarAgents = () => undefined,
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
  const [activeDragItem, setActiveDragItem] = useState<ActiveSidebarDragItem | null>(null)
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({})
  const [collapsedSpaceGroupIds, setCollapsedSpaceGroupIds] = useState<Record<string, boolean>>({})
  const [sidebarTransition, setSidebarTransition] = useState<SidebarTransition>(null)
  const previousVariantRef = useRef(variant)
  const transitionTimeoutRef = useRef<number | null>(null)
  const {
    scrollFade: sidebarListScrollFade,
    setListRef: setSidebarListRef,
    handleListScroll: handleSidebarListScroll,
  } = useSidebarListScroll()

  const resolveDragData = useCallback(
    (id: string, data: unknown): SidebarDragItemData | null => {
      const itemData = readSidebarDragItemData(data)
      if (itemData) {
        return itemData
      }

      return workspaces.some(workspace => workspace.id === id)
        ? { kind: 'project', workspaceId: id }
        : null
    },
    [workspaces],
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      const id = String(event.active.id)
      const activeData = (event.active as { data?: { current?: unknown } }).data?.current
      const itemData = resolveDragData(id, activeData)
      setActiveDragItem(itemData ? { id, data: itemData } : null)
    },
    [resolveDragData],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const nextActiveId = String(event.active.id)
      const nextOverId = event.over?.id

      setActiveDragItem(null)

      if (nextOverId === null || nextOverId === undefined) {
        return
      }

      const overId = String(nextOverId)
      if (overId === nextActiveId) {
        return
      }

      const activeEventData = (event.active as { data?: { current?: unknown } }).data?.current
      const overEventData = (event.over as { data?: { current?: unknown } } | null)?.data?.current
      const activeData = resolveDragData(nextActiveId, activeEventData)
      const overData = resolveDragData(overId, overEventData)
      if (!activeData || !overData || !canReorderSidebarDragItems(activeData, overData)) {
        return
      }

      if (activeData.kind === 'project' && overData.kind === 'project') {
        onReorderWorkspaces(activeData.workspaceId, overData.workspaceId)
        return
      }

      if (
        activeData.kind === 'space' &&
        overData.kind === 'space' &&
        activeData.workspaceId === overData.workspaceId
      ) {
        onReorderWorkspaceRootSpaces(activeData.workspaceId, activeData.spaceId, overData.spaceId)
        return
      }

      if (
        activeData.kind === 'agent' &&
        overData.kind === 'agent' &&
        activeData.workspaceId === overData.workspaceId &&
        activeData.groupId === overData.groupId
      ) {
        onReorderWorkspaceSidebarAgents(activeData.workspaceId, activeData.nodeId, overData.nodeId)
      }
    },
    [
      onReorderWorkspaceRootSpaces,
      onReorderWorkspaceSidebarAgents,
      onReorderWorkspaces,
      resolveDragData,
    ],
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

  const activeDragData = activeDragItem?.data ?? null
  const activeDragWorkspaceId = activeDragData?.workspaceId ?? null
  const activeDragTree =
    activeDragWorkspaceId !== null
      ? (trees.find(tree => tree.workspace.id === activeDragWorkspaceId) ?? null)
      : null
  const activeTree = activeDragData?.kind === 'project' ? activeDragTree : null
  const activeSpaceGroup =
    activeDragData?.kind === 'space'
      ? (activeDragTree?.spaceGroups.find(group => group.id === activeDragData.spaceId) ?? null)
      : null
  const activeAgentGroup =
    activeDragData?.kind === 'agent'
      ? activeDragTree
        ? (getTreeChildGroups(activeDragTree).find(group => group.id === activeDragData.groupId) ??
          null)
        : null
      : null
  const activeAgentItem =
    activeDragData?.kind === 'agent'
      ? (activeAgentGroup?.agents.find(agent => agent.node.id === activeDragData.nodeId) ?? null)
      : null
  const activeSpaceGroupKey =
    activeSpaceGroup && activeDragWorkspaceId
      ? `${activeDragWorkspaceId}:${activeSpaceGroup.id}`
      : null
  useLayoutEffect(() => {
    const previousVariant = previousVariantRef.current
    if (previousVariant === variant) {
      return
    }

    const nextTransition =
      previousVariant === 'rail' && variant !== 'rail'
        ? 'expanding'
        : previousVariant !== 'rail' && variant === 'rail'
          ? 'collapsing'
          : null

    previousVariantRef.current = variant
    if (transitionTimeoutRef.current !== null) {
      window.clearTimeout(transitionTimeoutRef.current)
      transitionTimeoutRef.current = null
    }
    setSidebarTransition(nextTransition)
    if (nextTransition === null) {
      return
    }

    transitionTimeoutRef.current = window.setTimeout(() => {
      setSidebarTransition(null)
      transitionTimeoutRef.current = null
    }, sidebarTransitionSettleMs)
  }, [variant])

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current !== null) {
        window.clearTimeout(transitionTimeoutRef.current)
      }
    }
  }, [])

  const transitionClassName =
    sidebarTransition === null
      ? ''
      : ` workspace-sidebar--transitioning workspace-sidebar--transition-${sidebarTransition}`
  const className = `workspace-sidebar workspace-sidebar--${variant}${transitionClassName}`

  return (
    <aside
      className={className}
      data-testid="workspace-sidebar"
      data-cove-sidebar-transition={sidebarTransition ?? 'idle'}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <SidebarToolbar
        isPinned={isPinned}
        showAddProject={variant !== 'rail' || sidebarTransition === 'collapsing'}
        onTogglePinned={onTogglePinned}
        onAddProject={onAddProject}
      />
      {variant !== 'rail' && persistNotice ? (
        <div
          className={`workspace-sidebar__persist-alert workspace-sidebar__persist-alert--${persistNotice.tone}`}
        >
          <strong>{t('sidebar.persistence')}</strong>
          <span>{persistNotice.message}</span>
        </div>
      ) : null}
      <div
        ref={setSidebarListRef}
        className="workspace-sidebar__list"
        data-cove-scroll-fade={sidebarListScrollFade}
        onScroll={handleSidebarListScroll}
      >
        {trees.length === 0 ? (
          <p className="workspace-sidebar__empty">{t('sidebar.noProjectYet')}</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={sidebarCollisionDetection}
            measuring={{
              droppable: {
                strategy: MeasuringStrategy.Always,
              },
            }}
            onDragStart={handleDragStart}
            onDragCancel={() => setActiveDragItem(null)}
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

            <DragOverlay dropAnimation={sidebarDropAnimation}>
              {activeTree ? <WorkspaceItemOverlay tree={activeTree} /> : null}
              {activeSpaceGroup ? (
                <SpaceItemOverlay
                  group={activeSpaceGroup}
                  isExpanded={
                    activeSpaceGroupKey === null ||
                    collapsedSpaceGroupIds[activeSpaceGroupKey] !== true
                  }
                />
              ) : null}
              {activeAgentItem ? <SidebarAgentItemOverlay item={activeAgentItem} /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </aside>
  )
}
