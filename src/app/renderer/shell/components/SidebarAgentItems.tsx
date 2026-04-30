import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL } from '@contexts/settings/domain/agentSettings'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { toRelativeTime } from '../utils/format'
import { buildSidebarAgentItems } from '../utils/sidebarAgents'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'

export function SidebarAgentItems({
  workspace,
  onSelectAgentNode,
}: {
  workspace: WorkspaceState
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const agentItems = buildSidebarAgentItems(workspace)

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
            key={`${workspace.id}:${node.id}`}
            className="workspace-agent-item workspace-agent-item--nested workspace-agent-item--sidebar"
            data-testid={`workspace-agent-item-${workspace.id}-${node.id}`}
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
              onSelectAgentNode(workspace.id, node.id)
            }}
          >
            <span className="workspace-agent-item__singleline">
              {provider ? (
                <AgentProviderIcon
                  provider={provider}
                  labelColor={effectiveLabelColor}
                  className="workspace-agent-item__provider"
                />
              ) : null}
              <span className="workspace-agent-item__headline">
                <span className="workspace-agent-item__title">{displayTitle}</span>
                {owningSpace ? (
                  <span
                    className="workspace-agent-item__pill"
                    data-cove-label-color={owningSpace.labelColor ?? undefined}
                    title={owningSpace.name}
                  >
                    <span className="workspace-agent-item__pill-text">{owningSpace.name}</span>
                  </span>
                ) : null}
              </span>
              <span
                className={`workspace-agent-item__status workspace-agent-item__status--agent workspace-agent-item__status--${status}`}
                aria-label={sidebarAgentStatusText}
                title={`${providerText} · ${startedText} · ${sidebarAgentStatusText}`}
              >
                <span className="workspace-agent-item__status-label">{sidebarAgentStatusText}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
