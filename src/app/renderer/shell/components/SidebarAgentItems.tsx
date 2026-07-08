import React from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL } from '@contexts/settings/domain/agentSettings'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { toRelativeTime } from '../utils/format'
import type { SidebarAgentItemModel } from '../utils/sidebarAgents'
import type { ProjectContextMenuState } from '../types'
import { createAgentSortableId, sidebarSortableTransition } from './SidebarDnd'

function SidebarAgentItemContent({
  item,
  showOwningSpacePill,
}: {
  item: SidebarAgentItemModel
  showOwningSpacePill: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { node, displayTitle, effectiveLabelColor, owningSpace, status } = item
  const provider = node.data.agent?.provider
  const providerText = provider ? AGENT_PROVIDER_LABEL[provider] : t('sidebar.fallbackAgentLabel')
  const startedText = toRelativeTime(node.data.startedAt)
  const sidebarAgentStatusText =
    status === 'working' ? t('sidebar.status.working') : t('sidebar.status.standby')

  return (
    <span className="workspace-agent-item__body">
      <span className="workspace-agent-item__singleline">
        <span className="workspace-agent-item__identity">
          {provider ? (
            <AgentProviderIcon
              provider={provider}
              labelColor={effectiveLabelColor}
              className={`workspace-agent-item__provider workspace-agent-item__provider--status workspace-agent-item__provider--status-${status}`}
            />
          ) : null}
          <span className="workspace-agent-item__status-label">{sidebarAgentStatusText}</span>
        </span>
        <span className="workspace-agent-item__headline">
          <span className="workspace-agent-item__title">{displayTitle}</span>
          {showOwningSpacePill && owningSpace ? (
            <span
              className="workspace-agent-item__pill"
              data-cove-label-color={owningSpace.labelColor ?? undefined}
              title={owningSpace.name}
            >
              <span className="workspace-agent-item__pill-text">{owningSpace.name}</span>
            </span>
          ) : null}
        </span>
      </span>
      <span
        className={`workspace-agent-item__status workspace-agent-item__status--agent workspace-agent-item__status--${status} workspace-agent-item__status--hidden`}
        title={`${providerText} · ${startedText} · ${sidebarAgentStatusText}`}
      >
        {sidebarAgentStatusText}
      </span>
    </span>
  )
}

function SidebarAgentItem({
  workspaceId,
  groupId,
  item,
  onSelectAgentNode,
  onOpenProjectContextMenu,
  showOwningSpacePill,
}: {
  workspaceId: string
  groupId: string | null
  item: SidebarAgentItemModel
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  showOwningSpacePill: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { node, displayTitle, effectiveLabelColor, owningSpace, status } = item
  const provider = node.data.agent?.provider
  const providerText = provider ? AGENT_PROVIDER_LABEL[provider] : t('sidebar.fallbackAgentLabel')
  const startedText = toRelativeTime(node.data.startedAt)
  const sidebarAgentStatusText =
    status === 'working' ? t('sidebar.status.working') : t('sidebar.status.standby')
  const sortableId = groupId ? createAgentSortableId(workspaceId, groupId, node.id) : node.id
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled: groupId === null,
    transition: sidebarSortableTransition,
    data: groupId
      ? {
          kind: 'agent',
          workspaceId,
          groupId,
          nodeId: node.id,
        }
      : undefined,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      className={`workspace-agent-item workspace-agent-item--nested workspace-agent-item--sidebar${
        isDragging ? ' workspace-agent-item--dragging' : ''
      }`}
      data-testid={`workspace-agent-item-${workspaceId}-${node.id}`}
      data-cove-label-color={effectiveLabelColor ?? undefined}
      title={[
        providerText,
        displayTitle,
        owningSpace?.name ?? null,
        sidebarAgentStatusText,
        startedText,
      ]
        .filter(Boolean)
        .join(' · ')}
      onClick={() => {
        onSelectAgentNode(workspaceId, node.id)
      }}
      onContextMenu={event => {
        event.preventDefault()
        onOpenProjectContextMenu({
          workspaceId,
          x: event.clientX,
          y: event.clientY,
          target: {
            kind: 'agent',
            workspaceId,
            nodeId: node.id,
          },
        })
      }}
      {...(groupId ? attributes : {})}
      {...(groupId ? listeners : {})}
    >
      <SidebarAgentItemContent item={item} showOwningSpacePill={showOwningSpacePill} />
    </button>
  )
}

export function SidebarAgentItems({
  workspaceId,
  groupId = null,
  agentItems,
  onSelectAgentNode,
  onOpenProjectContextMenu,
  showOwningSpacePill = false,
}: {
  workspaceId: string
  groupId?: string | null
  agentItems: SidebarAgentItemModel[]
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
          key={`${workspaceId}:${item.node.id}`}
          workspaceId={workspaceId}
          groupId={groupId}
          item={item}
          onSelectAgentNode={onSelectAgentNode}
          onOpenProjectContextMenu={onOpenProjectContextMenu}
          showOwningSpacePill={showOwningSpacePill}
        />
      ))}
    </div>
  )

  if (!groupId) {
    return content
  }

  return (
    <SortableContext
      items={agentItems.map(item => createAgentSortableId(workspaceId, groupId, item.node.id))}
      strategy={verticalListSortingStrategy}
    >
      {content}
    </SortableContext>
  )
}

export function SidebarAgentItemOverlay({
  item,
  showOwningSpacePill = false,
}: {
  item: SidebarAgentItemModel
  showOwningSpacePill?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { node, displayTitle, effectiveLabelColor, owningSpace, status } = item
  const provider = node.data.agent?.provider
  const providerText = provider ? AGENT_PROVIDER_LABEL[provider] : t('sidebar.fallbackAgentLabel')
  const startedText = toRelativeTime(node.data.startedAt)
  const sidebarAgentStatusText =
    status === 'working' ? t('sidebar.status.working') : t('sidebar.status.standby')

  return (
    <div
      className="workspace-agent-item workspace-agent-item--nested workspace-agent-item--sidebar workspace-agent-item--drag-overlay"
      data-testid="workspace-sidebar-drag-overlay"
      data-cove-label-color={effectiveLabelColor ?? undefined}
      data-cove-sidebar-drag-kind="agent"
      title={[
        providerText,
        displayTitle,
        owningSpace?.name ?? null,
        sidebarAgentStatusText,
        startedText,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <SidebarAgentItemContent item={item} showOwningSpacePill={showOwningSpacePill} />
    </div>
  )
}
