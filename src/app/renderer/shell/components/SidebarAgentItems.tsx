import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL } from '@contexts/settings/domain/agentSettings'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { toRelativeTime } from '../utils/format'
import type { SidebarAgentItemModel } from '../utils/sidebarAgents'
import type { ProjectContextMenuState } from '../types'

export function SidebarAgentItems({
  workspaceId,
  agentItems,
  onSelectAgentNode,
  onOpenProjectContextMenu,
  showOwningSpacePill = false,
}: {
  workspaceId: string
  agentItems: SidebarAgentItemModel[]
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
  onOpenProjectContextMenu: (state: ProjectContextMenuState) => void
  showOwningSpacePill?: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (agentItems.length === 0) {
    return null
  }

  return (
    <div className="workspace-item__agents">
      {agentItems.map(({ node, displayTitle, effectiveLabelColor, owningSpace, status }) => {
        const provider = node.data.agent?.provider
        const providerText = provider
          ? AGENT_PROVIDER_LABEL[provider]
          : t('sidebar.fallbackAgentLabel')
        const startedText = toRelativeTime(node.data.startedAt)
        const sidebarAgentStatusText =
          status === 'working' ? t('sidebar.status.working') : t('sidebar.status.standby')

        return (
          <button
            type="button"
            key={`${workspaceId}:${node.id}`}
            className="workspace-agent-item workspace-agent-item--nested workspace-agent-item--sidebar"
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
          >
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
                  <span className="workspace-agent-item__status-label">
                    {sidebarAgentStatusText}
                  </span>
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
          </button>
        )
      })}
    </div>
  )
}
