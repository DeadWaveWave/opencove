import React from 'react'
import { Circle, LoaderCircle, MoreHorizontal, Pause } from 'lucide-react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL } from '@contexts/settings/domain/agentSettings'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { toRelativeTime } from '../utils/format'
import type { SidebarAgentItemModel } from '../utils/sidebarAgents'
import type { ProjectContextMenuState } from '../types'
import { createAgentSortableId, sidebarSortableTransition } from './SidebarDnd'
import { resolveAgentTreatedProvider } from '@contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'

function SidebarAgentItemContent({ item }: { item: SidebarAgentItemModel }): React.JSX.Element {
  const { t } = useTranslation()
  const provider = resolveAgentTreatedProvider(item.node)
  const statusText = t(`sidebar.status.${item.status}`)
  const StatusIcon =
    item.status === 'working' ? LoaderCircle : item.status === 'waiting' ? Pause : Circle

  return (
    <>
      {provider ? (
        <AgentProviderIcon provider={provider} className="workspace-agent-item__provider" />
      ) : null}
      <span className="workspace-agent-item__copy">
        <span className="workspace-agent-item__title">{item.displayTitle}</span>
        <span
          className={`workspace-agent-item__status workspace-agent-item__status--agent workspace-agent-item__status--${item.status}`}
          title={statusText}
        >
          <StatusIcon size={11} aria-hidden="true" />
          <span className="workspace-agent-item__status-label">{statusText}</span>
        </span>
      </span>
    </>
  )
}

function SidebarAgentItem({
  workspaceId,
  groupId,
  item,
  isCurrent,
  onSelectAgentNode,
  onOpenProjectContextMenu,
}: {
  workspaceId: string
  groupId: string | null
  item: SidebarAgentItemModel
  isCurrent: boolean
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { node, displayTitle, effectiveLabelColor, status } = item
  const provider = resolveAgentTreatedProvider(node)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: groupId ? createAgentSortableId(workspaceId, groupId, node.id) : node.id,
    disabled: groupId === null,
    transition: sidebarSortableTransition,
    data: groupId ? { kind: 'agent', workspaceId, groupId, nodeId: node.id } : undefined,
  })
  const openMenu = (x: number, y: number): void =>
    onOpenProjectContextMenu({
      workspaceId,
      x,
      y,
      target: { kind: 'agent', workspaceId, nodeId: node.id },
    })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className={`workspace-agent-item workspace-agent-item--sidebar${isCurrent ? ' workspace-agent-item--current' : ''}${isDragging ? ' workspace-agent-item--dragging' : ''}`}
      data-cove-label-color={effectiveLabelColor ?? undefined}
    >
      <button
        type="button"
        className="workspace-agent-item__select"
        data-testid={`workspace-agent-item-${workspaceId}-${node.id}`}
        data-cove-label-color={effectiveLabelColor ?? undefined}
        aria-current={isCurrent ? 'location' : undefined}
        title={[
          provider ? AGENT_PROVIDER_LABEL[provider] : t('sidebar.fallbackAgentLabel'),
          displayTitle,
          t(`sidebar.status.${status}`),
          toRelativeTime(node.data.startedAt),
        ].join(' · ')}
        onClick={() => onSelectAgentNode(workspaceId, node.id)}
        onContextMenu={event => {
          event.preventDefault()
          openMenu(event.clientX, event.clientY)
        }}
        {...(groupId ? attributes : {})}
        {...(groupId ? listeners : {})}
      >
        <SidebarAgentItemContent item={item} />
      </button>
      <button
        type="button"
        className="workspace-sidebar__more"
        data-testid={`workspace-agent-more-${workspaceId}-${node.id}`}
        aria-label={`${t('sidebar.agentMore')}: ${displayTitle}`}
        title={t('sidebar.agentMore')}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          openMenu(rect.right, rect.bottom)
        }}
      >
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

export function SidebarAgentItems({
  workspaceId,
  groupId = null,
  agentItems,
  currentNodeId = null,
  onSelectAgentNode,
  onOpenProjectContextMenu,
}: {
  workspaceId: string
  groupId?: string | null
  agentItems: SidebarAgentItemModel[]
  currentNodeId?: string | null
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  showOwningSpacePill?: boolean
}): React.JSX.Element | null {
  if (agentItems.length === 0) {
    return null
  }
  const content = (
    <div className="workspace-item__agents">
      {agentItems.map(item => (
        <SidebarAgentItem
          key={item.node.id}
          workspaceId={workspaceId}
          groupId={groupId}
          item={item}
          isCurrent={item.node.id === currentNodeId}
          onSelectAgentNode={onSelectAgentNode}
          onOpenProjectContextMenu={onOpenProjectContextMenu}
        />
      ))}
    </div>
  )
  return groupId ? (
    <SortableContext
      items={agentItems.map(item => createAgentSortableId(workspaceId, groupId, item.node.id))}
      strategy={verticalListSortingStrategy}
    >
      {content}
    </SortableContext>
  ) : (
    content
  )
}

export function SidebarAgentItemOverlay({
  item,
}: {
  item: SidebarAgentItemModel
  showOwningSpacePill?: boolean
}): React.JSX.Element {
  return (
    <div
      className="workspace-agent-item workspace-agent-item--sidebar workspace-agent-item--drag-overlay"
      data-testid="workspace-sidebar-drag-overlay"
      data-cove-label-color={item.effectiveLabelColor ?? undefined}
      data-cove-sidebar-drag-kind="agent"
    >
      <span className="workspace-agent-item__select">
        <SidebarAgentItemContent item={item} />
      </span>
    </div>
  )
}
