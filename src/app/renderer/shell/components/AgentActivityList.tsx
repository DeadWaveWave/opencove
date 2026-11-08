import React from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { PlayIcon } from '@app/renderer/components/ui/pixelIcons'
import { KindTile } from '@app/renderer/components/ui/KindTile'
import { useTranslation } from '@app/renderer/i18n'
import { NodeKindIcon } from '@contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'
import { useAgentWaitingSinceStore, useMinuteClock } from '../hooks/useAgentWaitingSince'
import type { AgentActivityReference, AgentActivitySummary } from '../utils/agentActivitySummary'
import { describeWaitDuration, resolveWaitDuration } from '../utils/waitDuration'
import { ProjectTile } from './ProjectTile'

const ROW_SELECTOR = '[data-agent-activity-row]'

/** The agent's window icon: its mark on the AI tint, with its project's tile at the corner. */
export function AgentActivityMark({
  item,
  className,
}: {
  item: Pick<AgentActivityReference, 'workspaceId' | 'projectIconId' | 'provider'>
  className?: string
}): React.JSX.Element {
  return (
    <span className={`agent-activity-mark${className ? ` ${className}` : ''}`} aria-hidden="true">
      <KindTile kind="ai">
        <NodeKindIcon kind="agent" provider={item.provider} />
      </KindTile>
      <ProjectTile
        workspaceId={item.workspaceId}
        iconId={item.projectIconId}
        size="sm"
        className="agent-activity-mark__project"
      />
    </span>
  )
}

/** Up, down, Home and End walk the rows; the walk wraps at either end. */
function moveRowFocus(event: React.KeyboardEvent<HTMLElement>): void {
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR))
  if (rows.length === 0) {
    return
  }
  const current = rows.indexOf(document.activeElement as HTMLElement)
  const next =
    event.key === 'ArrowDown'
      ? (current + 1) % rows.length
      : event.key === 'ArrowUp'
        ? (current - 1 + rows.length) % rows.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? rows.length - 1
            : null
  if (next === null) {
    return
  }
  event.preventDefault()
  rows[next]?.focus()
}

export function focusFirstAgentActivityRow(list: HTMLElement | null): void {
  list?.querySelector<HTMLElement>(ROW_SELECTOR)?.focus()
}

/**
 * Every agent waiting for you, then every agent at work, across projects, as the lines of a game
 * menu: a pixel cursor points at the line under the pointer or focus. One click on a line jumps
 * to that agent.
 */
export function AgentActivityList({
  summary,
  onSelect,
}: {
  summary: AgentActivitySummary
  onSelect: (item: AgentActivityReference) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const observations = useAgentWaitingSinceStore(state => state.observations)
  const nowMs = useMinuteClock(summary.waiting.length > 0)

  const section = (
    tone: 'waiting' | 'working',
    label: string,
    items: readonly AgentActivityReference[],
  ) =>
    items.length === 0 ? null : (
      <section
        role="group"
        aria-label={label}
        className="agent-activity-list__section"
        data-tone={tone}
      >
        <h3 className="agent-activity-list__section-label" aria-hidden="true">
          {label}
          <span className="agent-activity-list__count">{items.length}</span>
        </h3>
        {items.map(item => {
          const place = `${item.projectName} · ${item.spaceName ?? t('sidebar.rootCanvas')}`
          const duration =
            tone === 'waiting'
              ? resolveWaitDuration(
                  observations.get(item.nodeId)?.waitingSinceMs ?? item.needsYouSinceMs ?? null,
                  nowMs,
                )
              : null
          const waited = duration ? describeWaitDuration(t, duration) : null
          return (
            <Button
              key={`${item.workspaceId}:${item.nodeId}`}
              variant="ghost"
              size="sm"
              className="agent-activity-list__row"
              data-agent-activity-row=""
              data-testid={`app-header-agent-activity-row-${item.workspaceId}-${item.nodeId}`}
              aria-label={
                waited
                  ? t('agentActivity.waitingRow', { title: item.title, place, waited })
                  : t('agentActivity.workingRow', { title: item.title, place })
              }
              onClick={() => onSelect(item)}
            >
              <span className="agent-activity-list__cursor" aria-hidden="true">
                <PlayIcon size={12} />
              </span>
              <AgentActivityMark item={item} />
              <span className="agent-activity-list__copy">
                <span className="agent-activity-list__title">{item.title}</span>
                <span className="agent-activity-list__place">{place}</span>
              </span>
              <span className="agent-activity-list__trailing" aria-hidden="true">
                {/* An unknown wait would only repeat the section's label. */}
                {duration ? (
                  duration.unit === 'unknown' ? null : (
                    waited
                  )
                ) : (
                  <span className="cove-status-pill__dots">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </span>
            </Button>
          )
        })}
      </section>
    )

  return (
    <div className="agent-activity-list__body" onKeyDown={moveRowFocus}>
      {section('waiting', t('agentActivity.waiting'), summary.waiting)}
      {section('working', t('agentActivity.working'), summary.working)}
    </div>
  )
}
