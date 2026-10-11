import { PluginSidebar } from '@contexts/plugins/presentation/renderer/PluginSidebar'
import React, { useCallback, useEffect, useState } from 'react'
import { MoreHorizontal, Settings } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useTranslation } from '@app/renderer/i18n'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import type { PersistNotice, ProjectContextMenuState } from '../types'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { SidebarToolbar } from './SidebarToolbar'
import { buildSidebarProjectTree } from '../utils/sidebarTree'
import { SidebarAgentItemOverlay } from './SidebarAgentItems'
import {
  getTreeChildGroups,
  SidebarWorkspaceNavigation,
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
import { SidebarProjectRailItem } from './SidebarProjectRailItem'
import { SidebarRemoteDetails } from './SidebarRemoteDetails'
import { useWorkspaceMountDetails } from '../hooks/useWorkspaceMountSummaries'
import { useAppStore } from '../store/useAppStore'
import { toggleSidebarCollapsedId } from '@contexts/settings/domain/sidebarTreeSettings'
import {
  setSidebarItemHidden,
  type SidebarViewMode,
} from '@contexts/settings/domain/sidebarViewSettings'
import { projectSidebarView } from '../utils/sidebarView'
import { SidebarViewControls } from './SidebarViewControls'

export type SidebarVariant = 'docked' | 'rail' | 'peek'
type SidebarProps = {
  variant?: SidebarVariant
  isPinned?: boolean
  isMobile?: boolean
  isMenuOpen?: boolean
  onClose?: () => void
  onInteractionActiveChange?: (active: boolean) => void
  currentNodeId?: string | null
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  persistNotice: PersistNotice | null
  onTogglePinned?: () => void
  onAddProject?: (anchor?: { x: number; y: number }) => void
  onOpenSettings?: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onSelectProjectCanvas?: (workspaceId: string) => void
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
  isMobile = false,
  isMenuOpen = false,
  onClose,
  onInteractionActiveChange,
  currentNodeId = null,
  workspaces,
  activeWorkspaceId,
  persistNotice,
  onTogglePinned = () => undefined,
  onAddProject = () => undefined,
  onOpenSettings,
  onSelectWorkspace,
  onSelectProjectCanvas = onSelectWorkspace,
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
  const mountDetails = useWorkspaceMountDetails({ workspaces })
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
  const [activeDragItem, setActiveDragItem] = useState<ActiveSidebarDragItem | null>(null)
  const collapsedSpaceGroupIds = useAppStore(
    state => state.agentSettings.sidebarCollapsedSpaceGroupIds,
  )
  const setAgentSettings = useAppStore(state => state.setAgentSettings)
  const [previewWorkspaceId, setPreviewWorkspaceId] = useState<string | null>(null)
  const [isRemoteDetailsOpen, setIsRemoteDetailsOpen] = useState(false)
  const [restoredLabel, setRestoredLabel] = useState<string | null>(null)
  const sidebarView = useAppStore(state => state.agentSettings.sidebarView)
  useEffect(() => setPreviewWorkspaceId(null), [activeWorkspaceId])
  const isInteractionActive = activeDragItem !== null || isRemoteDetailsOpen
  const isPreviewLocked = isInteractionActive || isMenuOpen
  const displayedTree =
    trees.find(tree => tree.workspace.id === (previewWorkspaceId ?? activeWorkspaceId)) ??
    trees.find(tree => tree.workspace.id === activeWorkspaceId) ??
    trees[0]
  const projectedView = displayedTree ? projectSidebarView(displayedTree, sidebarView) : null
  useEffect(() => {
    if (!restoredLabel) {
      return
    }
    const timeout = window.setTimeout(() => setRestoredLabel(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [restoredLabel])
  useEffect(() => {
    onInteractionActiveChange?.(isInteractionActive)
    return () => onInteractionActiveChange?.(false)
  }, [isInteractionActive, onInteractionActiveChange])
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

  const handleToggleSpaceGroup = useCallback(
    (groupKey: string): void => {
      setAgentSettings(prev => ({
        ...prev,
        sidebarCollapsedSpaceGroupIds: toggleSidebarCollapsedId(
          prev.sidebarCollapsedSpaceGroupIds,
          groupKey,
        ),
      }))
    },
    [setAgentSettings],
  )

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
  const className = `workspace-sidebar workspace-sidebar--${variant}${isMobile ? ' workspace-sidebar--mobile' : ''}`

  return (
    <aside
      className={className}
      data-cove-part="sidebar"
      data-testid="workspace-sidebar"
      data-cove-preview-workspace-id={displayedTree?.workspace.id}
      onPointerLeave={event => {
        if (!isPreviewLocked) {
          setPreviewWorkspaceId(null)
        }
        onPointerLeave?.(event)
      }}
    >
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
        <div className="workspace-project-rail" data-testid="workspace-project-rail">
          <SidebarToolbar
            isPinned={isPinned}
            isMobile={isMobile}
            onClose={onClose}
            onTogglePinned={onTogglePinned}
            onAddProject={onAddProject}
          />
          <div
            ref={setSidebarListRef}
            className="workspace-sidebar__list"
            data-cove-scroll-fade={sidebarListScrollFade}
            onScroll={handleSidebarListScroll}
          >
            <SortableContext
              items={trees.map(tree => tree.workspace.id)}
              strategy={verticalListSortingStrategy}
            >
              {trees.map(tree => (
                <SidebarProjectRailItem
                  key={tree.workspace.id}
                  workspace={tree.workspace}
                  isActive={tree.workspace.id === activeWorkspaceId}
                  isPreviewed={tree.workspace.id === displayedTree?.workspace.id}
                  remote={mountDetails[tree.workspace.id]?.remote ?? null}
                  waitingAgentCount={getTreeChildGroups(tree).reduce(
                    (count, group) =>
                      count + group.agents.filter(agent => agent.status === 'waiting').length,
                    0,
                  )}
                  onPreview={workspaceId => {
                    if (!isPreviewLocked && !isMobile) {
                      setPreviewWorkspaceId(workspaceId)
                    }
                  }}
                  onProjectPointerEnter={onPointerEnter}
                  onSelectWorkspace={workspaceId => {
                    setPreviewWorkspaceId(null)
                    onSelectWorkspace(workspaceId)
                  }}
                  onOpenProjectContextMenu={onOpenProjectContextMenu}
                />
              ))}
            </SortableContext>
          </div>
          {onOpenSettings ? (
            <div className="workspace-sidebar__footer" data-testid="workspace-sidebar-footer">
              <IconButton
                className="workspace-sidebar__toolbar-button"
                data-testid="app-header-settings"
                label={t('common.settings')}
                onClick={() => onOpenSettings()}
              >
                <Settings aria-hidden="true" />
              </IconButton>
            </div>
          ) : null}
        </div>
        {variant !== 'rail' || isMobile ? (
          <div className="workspace-sidebar__navigation" data-testid="workspace-sidebar-navigation">
            {displayedTree ? (
              <>
                <header className="workspace-sidebar__project-header">
                  <h2 title={displayedTree.workspace.name}>{displayedTree.workspace.name}</h2>
                  <SidebarViewControls
                    key={`view-mode-${displayedTree.workspace.id}`}
                    mode={sidebarView.mode}
                    hiddenWaitingCount={projectedView?.hiddenWaitingCount ?? 0}
                    onChange={mode =>
                      setAgentSettings(previous => ({
                        ...previous,
                        sidebarView: {
                          ...previous.sidebarView,
                          mode: mode as SidebarViewMode,
                        },
                      }))
                    }
                  />
                  <SidebarRemoteDetails
                    key={displayedTree.workspace.id}
                    remote={mountDetails[displayedTree.workspace.id]?.remote ?? null}
                    onOpenChange={setIsRemoteDetailsOpen}
                  />
                  <button
                    type="button"
                    className="workspace-sidebar__more"
                    data-testid={`workspace-project-more-${displayedTree.workspace.id}`}
                    aria-label={t('sidebar.projectMore')}
                    title={t('sidebar.projectMore')}
                    onClick={event => {
                      const rect = event.currentTarget.getBoundingClientRect()
                      const workspaceId = displayedTree.workspace.id
                      onOpenProjectContextMenu({
                        workspaceId,
                        x: rect.right,
                        y: rect.bottom,
                        target: { kind: 'project', workspaceId },
                      })
                    }}
                  >
                    <MoreHorizontal size={15} aria-hidden="true" />
                  </button>
                </header>
                {persistNotice ? (
                  <div
                    className={`workspace-sidebar__persist-alert workspace-sidebar__persist-alert--${persistNotice.tone}`}
                  >
                    <strong>{t('sidebar.persistence')}</strong>
                    <span>{persistNotice.message}</span>
                  </div>
                ) : null}
                <div className="workspace-sidebar__tree-scroll">
                  <SidebarWorkspaceNavigation
                    tree={projectedView?.tree ?? displayedTree}
                    isActive={displayedTree.workspace.id === activeWorkspaceId}
                    currentNodeId={currentNodeId}
                    collapsedSpaceGroupIds={collapsedSpaceGroupIds}
                    onToggleSpaceGroup={handleToggleSpaceGroup}
                    onSelectProjectCanvas={onSelectProjectCanvas}
                    onSelectSpace={onSelectSpace}
                    onOpenProjectContextMenu={onOpenProjectContextMenu}
                    onSelectAgentNode={onSelectAgentNode}
                    onRestoreSidebarItem={(kind, itemId, name) => {
                      setAgentSettings(previous => ({
                        ...previous,
                        sidebarView: setSidebarItemHidden(
                          previous.sidebarView,
                          kind,
                          displayedTree.workspace.id,
                          itemId,
                          false,
                        ),
                      }))
                      setRestoredLabel(name)
                    }}
                  />
                  <PluginSidebar projectId={displayedTree.workspace.id} />
                  {projectedView?.matchingAgentCount === 0 &&
                  projectedView.tree.spaceGroups.length === 0 &&
                  (sidebarView.mode ?? 'normal') !== 'normal' ? (
                    <p className="workspace-sidebar__empty">{t('sidebar.noMatches')}</p>
                  ) : null}
                </div>
                <div className="workspace-sidebar__feedback" role="status" aria-live="polite">
                  {restoredLabel ? t('sidebar.restored', { name: restoredLabel }) : null}
                </div>
              </>
            ) : (
              <p className="workspace-sidebar__empty">{t('sidebar.noProjectYet')}</p>
            )}
          </div>
        ) : null}
        <DragOverlay dropAnimation={sidebarDropAnimation}>
          {activeTree ? <WorkspaceItemOverlay tree={activeTree} /> : null}
          {activeSpaceGroup ? <SpaceItemOverlay group={activeSpaceGroup} /> : null}
          {activeAgentItem ? <SidebarAgentItemOverlay item={activeAgentItem} /> : null}
        </DragOverlay>
      </DndContext>
    </aside>
  )
}
