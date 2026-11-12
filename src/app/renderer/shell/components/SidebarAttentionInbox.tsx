import React from 'react'
import { agentAttentionLabelKey } from '@contexts/workspace/presentation/renderer/utils/agentAttentionLabel'
import { useTranslation } from '@app/renderer/i18n'
import { Button } from '@app/renderer/components/ui/Button'
import type { AgentActivityReference } from '../utils/agentActivitySummary'
import { describeWaitDuration, resolveWaitDuration } from '../utils/waitDuration'
import { useAgentWaitingSinceStore, useMinuteClock } from '../hooks/useAgentWaitingSince'
import { ProjectTile } from './ProjectTile'

/** Every agent waiting for you, across projects; one click opens its project and focuses it. */
export function SidebarAttentionInbox({
  items,
  onSelectAgentNode,
}: {
  items: readonly AgentActivityReference[]
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const observations = useAgentWaitingSinceStore(state => state.observations)
  const nowMs = useMinuteClock(items.length > 0)
  if (items.length === 0) {
    return null
  }

  return (
    <section
      className="workspace-attention-inbox"
      data-testid="workspace-attention-inbox"
      aria-label={t('sidebar.inbox.title')}
    >
      <h3 className="workspace-attention-inbox__title">
        <span>{t('sidebar.inbox.title')}</span>
        <span className="workspace-attention-inbox__count">{items.length}</span>
      </h3>
      {items.map(item => {
        const place = `${item.projectName} · ${item.spaceName ?? t('sidebar.rootCanvas')}`
        const status = t(agentAttentionLabelKey(item))
        const duration = resolveWaitDuration(
          observations.get(item.nodeId)?.waitingSinceMs ?? item.needsYouSinceMs ?? null,
          nowMs,
        )
        const waited = duration.unit === 'unknown' ? '' : describeWaitDuration(t, duration)
        return (
          <Button
            key={`${item.workspaceId}:${item.nodeId}`}
            variant="ghost"
            size="sm"
            className="workspace-attention-inbox__item"
            data-testid={`workspace-attention-item-${item.workspaceId}-${item.nodeId}`}
            aria-label={
              waited
                ? t('sidebar.inbox.rowLabel', { title: item.title, place, waited, status })
                : t('agentActivity.attentionRow', { title: item.title, place, status })
            }
            onClick={() => onSelectAgentNode(item.workspaceId, item.nodeId)}
          >
            <ProjectTile workspaceId={item.workspaceId} iconId={item.projectIconId} size="sm" />
            <span className="workspace-attention-inbox__item-title">{item.title}</span>
            <span className="workspace-attention-inbox__meta">
              <span className="workspace-attention-inbox__place">{place}</span>
              <span className="workspace-attention-inbox__waited">
                {status}
                {waited ? ` · ${waited}` : ''}
              </span>
            </span>
          </Button>
        )
      })}
    </section>
  )
}
