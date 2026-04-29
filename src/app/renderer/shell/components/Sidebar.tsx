import React, { useCallback, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation, type TranslateFn } from '@app/renderer/i18n'
import type { PersistNotice, ProjectContextMenuState } from '../types'
import { useWorkspaceMountSummaries } from '../hooks/useWorkspaceMountSummaries'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { SidebarAgentItems } from './SidebarAgentItems'
import { getWorkspaceAgents } from '../utils/sidebarAgents'

type SidebarProps = {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
  activeProviderLabel: string
  activeProviderModel: string
  persistNotice: PersistNotice | null
  onAddWorkspace: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onReorderWorkspaces: (activeId: string, overId: string) => void
}

type SortableWorkspaceItemProps = {
  workspace: WorkspaceState
  isActive: boolean
  isExpanded: boolean
  subtitle: string
  onToggleAgents: (workspaceId: string) => void
  onSelectWorkspace: (workspaceId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
}

function getWorkspaceMetaText(workspace: WorkspaceState, t: TranslateFn): string {
  let terminalCount = 0
  let agentCount = 0
  let taskCount = 0

  for (const node of workspace.nodes) {
    if (node.data.kind === 'terminal') {
      terminalCount += 1
    } else if (node.data.kind === 'agent') {
      agentCount += 1
    } else if (node.data.kind === 'task') {
      taskCount += 1
    }
  }

  return [
    t('sidebar.terminals', { count: terminalCount }),
    t('sidebar.agents', { count: agentCount }),
    t('sidebar.tasks', { count: taskCount }),
  ].join(' · ')
}

function WorkspaceItemContent({
  workspace,
  subtitle,
  metaText,
  hasAgents,
  isExpanded,
}: {
  workspace: WorkspaceState
  subtitle: string
  metaText: string
  hasAgents: boolean
  isExpanded: boolean
}): React.JSX.Element {
  const FolderIcon = hasAgents && isExpanded ? FolderOpen : Folder

  return (
    <>
      <span className="workspace-item__headline">
        <FolderIcon className="workspace-item__folder-icon" aria-hidden="true" />
        <span className="workspace-item__name">{workspace.name}</span>
      </span>
      <span className="workspace-item__subtitle">{subtitle}</span>
      <span className="workspace-item__meta">{metaText}</span>
    </>
  )
}

function SortableWorkspaceItem({
  workspace,
  isActive,
  isExpanded,
  subtitle,
  onToggleAgents,
  onSelectWorkspace,
  onOpenProjectContextMenu,
  onSelectAgentNode,
}: SortableWorkspaceItemProps): React.JSX.Element {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const metaText = getWorkspaceMetaText(workspace, t)
  const workspaceAgents = getWorkspaceAgents(workspace)
  const hasAgents = workspaceAgents.length > 0

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="workspace-item-group">
      <div className="workspace-item-row">
        {hasAgents ? (
          <button
            type="button"
            className="workspace-item__tree-toggle"
            data-testid={`workspace-item-toggle-${workspace.id}`}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded ? t('sidebar.collapseProjectAgents') : t('sidebar.expandProjectAgents')
            }
            onClick={event => {
              event.stopPropagation()
              onToggleAgents(workspace.id)
            }}
          >
            {isExpanded ? (
              <ChevronDown className="workspace-item__tree-icon" aria-hidden="true" />
            ) : (
              <ChevronRight className="workspace-item__tree-icon" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="workspace-item__tree-spacer" aria-hidden="true" />
        )}

        <button
          type="button"
          className={`workspace-item ${isActive ? 'workspace-item--active' : ''}`}
          data-testid={`workspace-item-${workspace.id}`}
          onClick={() => {
            onSelectWorkspace(workspace.id)
          }}
          onContextMenu={event => {
            event.preventDefault()
            onOpenProjectContextMenu({
              workspaceId: workspace.id,
              x: event.clientX,
              y: event.clientY,
            })
          }}
          title={workspace.name}
          {...listeners}
        >
          <WorkspaceItemContent
            workspace={workspace}
            subtitle={subtitle}
            metaText={metaText}
            hasAgents={hasAgents}
            isExpanded={isExpanded}
          />
        </button>
      </div>

      {isExpanded ? (
        <SidebarAgentItems workspace={workspace} onSelectAgentNode={onSelectAgentNode} />
      ) : null}
    </div>
  )
}

function WorkspaceItemOverlay({
  workspace,
  subtitle,
}: {
  workspace: WorkspaceState
  subtitle: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const workspaceAgents = getWorkspaceAgents(workspace)

  return (
    <div
      className="workspace-item-group workspace-item-group--drag-overlay"
      data-testid="workspace-item-overlay"
    >
      <div className="workspace-item workspace-item--drag-overlay">
        <WorkspaceItemContent
          workspace={workspace}
          subtitle={subtitle}
          metaText={getWorkspaceMetaText(workspace, t)}
          hasAgents={workspaceAgents.length > 0}
          isExpanded={true}
        />
      </div>
    </div>
  )
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  activeProviderLabel,
  activeProviderModel,
  persistNotice,
  onAddWorkspace,
  onSelectWorkspace,
  onOpenProjectContextMenu,
  onSelectAgentNode,
  onReorderWorkspaces,
}: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()
  const mountSummaryByWorkspaceId = useWorkspaceMountSummaries({ workspaces })
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({})

  const handleDragStart = useCallback((event: DragStartEvent): void => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragCancel = useCallback((): void => {
    setActiveId(null)
  }, [])

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

  const handleToggleAgents = useCallback((workspaceId: string): void => {
    setCollapsedWorkspaceIds(prev => ({
      ...prev,
      [workspaceId]: prev[workspaceId] !== true,
    }))
  }, [])

  const activeWorkspace =
    activeId === null ? null : (workspaces.find(workspace => workspace.id === activeId) ?? null)

  return (
    <aside className="workspace-sidebar">
      <div className="workspace-sidebar__header">
        <div className="workspace-sidebar__header-main">
          <h1>{t('sidebar.projects')}</h1>
        </div>
        <button
          type="button"
          data-testid="sidebar-add-project"
          onClick={() => {
            onAddWorkspace()
          }}
        >
          {t('sidebar.addProject')}
        </button>
      </div>

      <div className="workspace-sidebar__agent">
        <span className="workspace-sidebar__agent-label">{t('sidebar.defaultAgent')}</span>
        <strong className="workspace-sidebar__agent-provider">{activeProviderLabel}</strong>
        <span className="workspace-sidebar__agent-model">{activeProviderModel}</span>
      </div>

      {persistNotice ? (
        <div
          className={`workspace-sidebar__persist-alert workspace-sidebar__persist-alert--${persistNotice.tone}`}
        >
          <strong>{t('sidebar.persistence')}</strong>
          <span>{persistNotice.message}</span>
        </div>
      ) : null}

      <div className="workspace-sidebar__list">
        {workspaces.length === 0 ? (
          <p className="workspace-sidebar__empty">{t('sidebar.noProjectYet')}</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={workspaces.map(workspace => workspace.id)}
              strategy={verticalListSortingStrategy}
            >
              {workspaces.map(workspace => (
                <SortableWorkspaceItem
                  key={workspace.id}
                  workspace={workspace}
                  isActive={workspace.id === activeWorkspaceId}
                  isExpanded={collapsedWorkspaceIds[workspace.id] !== true}
                  subtitle={mountSummaryByWorkspaceId[workspace.id] ?? '—'}
                  onToggleAgents={handleToggleAgents}
                  onSelectWorkspace={onSelectWorkspace}
                  onOpenProjectContextMenu={onOpenProjectContextMenu}
                  onSelectAgentNode={onSelectAgentNode}
                />
              ))}
            </SortableContext>

            <DragOverlay>
              {activeWorkspace ? (
                <WorkspaceItemOverlay
                  workspace={activeWorkspace}
                  subtitle={mountSummaryByWorkspaceId[activeWorkspace.id] ?? '—'}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </aside>
  )
}
