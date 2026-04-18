import React, { useCallback, useState } from 'react'
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
import { AGENT_PROVIDER_LABEL } from '@contexts/settings/domain/agentSettings'
import type { PersistNotice, ProjectContextMenuState } from '../types'
import { toRelativeTime } from '../utils/format'
import { useWorkspaceMountSummaries } from '../hooks/useWorkspaceMountSummaries'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'

type SidebarAgentStatus = 'working' | 'standby'

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
  subtitle: string
  onSelectWorkspace: (workspaceId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
}

function resolveSidebarAgentStatus(runtimeStatus: TerminalNodeData['status']): SidebarAgentStatus {
  if (runtimeStatus === null) {
    return 'working'
  }

  if (runtimeStatus === 'running' || runtimeStatus === 'restoring') {
    return 'working'
  }

  return 'standby'
}

function getWorkspaceAgents(workspace: WorkspaceState) {
  return workspace.nodes
    .filter(node => node.data.kind === 'agent')
    .sort((left, right) => {
      const leftTime = left.data.startedAt ? Date.parse(left.data.startedAt) : 0
      const rightTime = right.data.startedAt ? Date.parse(right.data.startedAt) : 0
      return rightTime - leftTime
    })
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

function resolveLinkedTaskTitle(workspace: WorkspaceState, nodeId: string, taskId: string | null) {
  const linkedTaskNode =
    (taskId
      ? (workspace.nodes.find(
          candidate =>
            candidate.id === taskId && candidate.data.kind === 'task' && candidate.data.task,
        ) ?? null)
      : null) ??
    workspace.nodes.find(
      candidate =>
        candidate.data.kind === 'task' && candidate.data.task?.linkedAgentNodeId === nodeId,
    ) ??
    null

  return linkedTaskNode && linkedTaskNode.data.kind === 'task' ? linkedTaskNode.data.title : null
}

function WorkspaceItemContent({
  workspace,
  subtitle,
  metaText,
}: {
  workspace: WorkspaceState
  subtitle: string
  metaText: string
}): React.JSX.Element {
  return (
    <>
      <span className="workspace-item__name">{workspace.name}</span>
      <span className="workspace-item__subtitle">{subtitle}</span>
      <span className="workspace-item__meta">{metaText}</span>
    </>
  )
}

function WorkspaceAgentItems({
  workspace,
  onSelectAgentNode,
}: {
  workspace: WorkspaceState
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const workspaceAgents = getWorkspaceAgents(workspace)

  if (workspaceAgents.length === 0) {
    return null
  }

  return (
    <div className="workspace-item__agents">
      {workspaceAgents.map(node => {
        const provider = node.data.agent?.provider
        const providerText = provider
          ? AGENT_PROVIDER_LABEL[provider]
          : t('sidebar.fallbackAgentLabel')
        const sidebarAgentStatus = resolveSidebarAgentStatus(node.data.status)
        const sidebarAgentStatusTone = sidebarAgentStatus
        const startedText = toRelativeTime(node.data.startedAt)
        const sidebarAgentStatusText =
          sidebarAgentStatus === 'working'
            ? t('sidebar.status.working')
            : t('sidebar.status.standby')
        const taskTitle = resolveLinkedTaskTitle(
          workspace,
          node.id,
          node.data.agent?.taskId ?? null,
        )

        return (
          <button
            type="button"
            key={`${workspace.id}:${node.id}`}
            className="workspace-agent-item workspace-agent-item--nested"
            data-testid={`workspace-agent-item-${workspace.id}-${node.id}`}
            onClick={() => {
              onSelectAgentNode(workspace.id, node.id)
            }}
          >
            <span className="workspace-agent-item__headline">
              <span className="workspace-agent-item__title">{node.data.title}</span>
            </span>
            <span className="workspace-agent-item__meta">
              <span className="workspace-agent-item__meta-text">
                {providerText} · {startedText}
              </span>
              <span
                className={`workspace-agent-item__status workspace-agent-item__status--agent workspace-agent-item__status--${sidebarAgentStatusTone}`}
              >
                {sidebarAgentStatusText}
              </span>
            </span>
            {taskTitle ? (
              <span className="workspace-agent-item__task" title={taskTitle}>
                <span className="workspace-agent-item__task-text">{taskTitle}</span>
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function SortableWorkspaceItem({
  workspace,
  isActive,
  subtitle,
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

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="workspace-item-group">
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
        <WorkspaceItemContent workspace={workspace} subtitle={subtitle} metaText={metaText} />
      </button>

      <WorkspaceAgentItems workspace={workspace} onSelectAgentNode={onSelectAgentNode} />
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
                  subtitle={mountSummaryByWorkspaceId[workspace.id] ?? '—'}
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
