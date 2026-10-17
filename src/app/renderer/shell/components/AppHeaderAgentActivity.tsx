import React from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { StatusPill } from '@app/renderer/components/ui/StatusPill'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentActivitySummary } from '../utils/agentActivitySummary'

/** Agent activity across every project: one click reaches the first agent waiting for you. */
export function AppHeaderAgentActivity({
  summary,
  onFocusAgent,
}: {
  summary: AgentActivitySummary
  onFocusAgent: (workspaceId: string, nodeId: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const first = summary.waiting[0]
  if (first) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="app-header__agent-activity"
        data-testid="app-header-agent-activity"
        aria-label={t('appHeader.goToWaitingAgent', {
          count: summary.waiting.length,
          title: first.title,
        })}
        onClick={() => {
          onFocusAgent(first.workspaceId, first.nodeId)
        }}
      >
        <StatusPill tone="waiting">
          {t('appHeader.agentsWaiting', { count: summary.waiting.length })}
        </StatusPill>
      </Button>
    )
  }
  if (summary.workingCount > 0) {
    return (
      <span className="app-header__agent-activity" data-testid="app-header-agent-activity">
        <StatusPill tone="working">
          {t('appHeader.agentsWorking', { count: summary.workingCount })}
        </StatusPill>
      </span>
    )
  }
  return null
}
