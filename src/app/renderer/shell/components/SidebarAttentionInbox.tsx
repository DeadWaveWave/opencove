import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { Button } from '@app/renderer/components/ui/Button'
import type { WaitingAgentReference } from '../utils/agentActivitySummary'
import { resolveWaitDuration, type WaitDuration } from '../utils/waitDuration'
import { useAgentWaitingSinceStore, useMinuteClock } from '../hooks/useAgentWaitingSince'
import { ProjectTile } from './ProjectTile'

/** Every agent waiting for you, across projects; one click opens its project and focuses it. */
export function SidebarAttentionInbox({
  items,
  onSelectAgentNode,
}: {
  items: readonly WaitingAgentReference[]
  onSelectAgentNode: (workspaceId: string, nodeId: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const observations = useAgentWaitingSinceStore(state => state.observations)
  const nowMs = useMinuteClock(items.length > 0)
  if (items.length === 0) {
    return null
  }

  const describeWait = (duration: WaitDuration): string =>
    duration.unit === 'unknown' || duration.unit === 'now'
      ? t(`sidebar.inbox.${duration.unit}`)
      : t(`sidebar.inbox.${duration.unit}`, { count: duration.count })

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
        const waited = describeWait(
          resolveWaitDuration(observations.get(item.nodeId)?.waitingSinceMs ?? null, nowMs),
        )
        return (
          <Button
            key={`${item.workspaceId}:${item.nodeId}`}
            variant="ghost"
            size="sm"
            className="workspace-attention-inbox__item"
            data-testid={`workspace-attention-item-${item.workspaceId}-${item.nodeId}`}
            aria-label={t('sidebar.inbox.rowLabel', { title: item.title, place, waited })}
            onClick={() => onSelectAgentNode(item.workspaceId, item.nodeId)}
          >
            <ProjectTile workspaceId={item.workspaceId} iconId={item.projectIconId} size="sm" />
            <span className="workspace-attention-inbox__item-title">{item.title}</span>
            <span className="workspace-attention-inbox__meta">
              <span className="workspace-attention-inbox__place">{place}</span>
              <span className="workspace-attention-inbox__waited">{waited}</span>
            </span>
          </Button>
        )
      })}
    </section>
  )
}
