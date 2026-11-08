import React from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { Tooltip } from '@app/renderer/components/ui/Tooltip'
import {
  CloseIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  GridIcon,
  TaskIcon,
} from '@app/renderer/components/ui/pixelIcons'
import { useTranslation } from '@app/renderer/i18n'
import { useIslandCountdown } from '../hooks/useIslandCountdown'
import type { AgentActivityReference } from '../utils/agentActivitySummary'
import type {
  AgentStandbyCardContextVisibility,
  AgentStandbyNotification,
} from '../utils/agentStandbyNotification'
import { AgentActivityMark } from './AgentActivityList'
import { ProjectIcon } from './ProjectIcon'

/** How long a card stays before it retracts into the pill, counting only unpaused time. */
export const AGENT_ISLAND_CARD_MS = 6_000
/** The retract's three hard frames. */
export const AGENT_ISLAND_RETRACT_MS = 150

export interface AgentIslandCardLayout {
  y: number
  scale: number
  /** A tucked card takes the front card's height, so only its lower edge shows. */
  height: number | null
  isTucked: boolean
  zIndex: number
}

/** One card per time an Agent ends a turn: the same Agent waiting again is a new card. */
export function islandCardKey(notification: AgentStandbyNotification): string {
  return `${notification.id}:${notification.createdAt}`
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function Chip({
  testId,
  label,
  value,
  icon,
  hint,
  isCode = false,
}: {
  testId: string
  label: string
  value: string
  icon: React.ReactNode
  /** Replaces "label: value" as the chip's tooltip. */
  hint?: string
  isCode?: boolean
}): React.JSX.Element {
  // The card's button already reads every chip's value, so the tooltip only shows.
  return (
    <Tooltip content={hint ?? `${label}: ${value}`} side="bottom" describe={false}>
      <span
        className={`app-notification__chip agent-island-card__chip${isCode ? ' agent-island-card__chip--code' : ''}`}
        data-testid={testId}
      >
        {icon}
        <span className="agent-island-card__chip-value">{value}</span>
      </span>
    </Tooltip>
  )
}

/**
 * One Agent that needs you, as a pixel window under the pill: its window icon, its title, a
 * blinking amber light, its context and a row of 12 pixel cells that go out over six seconds.
 * Then it retracts into the pill, unless the pointer or focus rests on the stack or OpenCove
 * is behind another app.
 */
export function AgentIslandCard({
  notification,
  live,
  contextVisibility,
  layout,
  paused,
  onHeight,
  onActivate,
  onRetract,
  onDismiss,
}: {
  notification: AgentStandbyNotification
  /** The agent as the pill sees it now: its mark and project icon. */
  live: AgentActivityReference | null
  contextVisibility: AgentStandbyCardContextVisibility
  layout: AgentIslandCardLayout
  paused: boolean
  /** Keyed by `islandCardKey`. */
  onHeight: (key: string, height: number) => void
  onActivate: (notification: AgentStandbyNotification) => void
  /** The countdown ran out: the card goes back into the pill, which keeps the Agent. */
  onRetract: (notification: AgentStandbyNotification) => void
  /** ✕: you answered it, so the Agent leaves the pill too. */
  onDismiss: (notification: AgentStandbyNotification) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const innerRef = React.useRef<HTMLDivElement | null>(null)
  const [leaving, setLeaving] = React.useState<'retract' | 'dismiss' | null>(null)
  const { id } = notification
  const cardKey = islandCardKey(notification)

  const retract = React.useCallback(() => {
    setLeaving(previous => previous ?? 'retract')
  }, [])
  const dismiss = React.useCallback(() => {
    setLeaving(previous => previous ?? 'dismiss')
  }, [])
  useIslandCountdown({ durationMs: AGENT_ISLAND_CARD_MS, paused, onExpire: retract })

  React.useEffect(() => {
    if (!leaving) {
      return undefined
    }
    const timer = window.setTimeout(
      () => (leaving === 'retract' ? onRetract : onDismiss)(notification),
      prefersReducedMotion() ? 0 : AGENT_ISLAND_RETRACT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [leaving, notification, onDismiss, onRetract])

  // The stack lays the cards out by their natural heights.
  React.useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) {
      return undefined
    }
    onHeight(cardKey, inner.offsetHeight)
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver(() => onHeight(cardKey, inner.offsetHeight))
    observer.observe(inner)
    return () => observer.disconnect()
  }, [cardKey, onHeight])

  const git = contextVisibility.showBranch ? notification.gitContext : null
  const pullRequest = contextVisibility.showPullRequest ? notification.pullRequest : null

  return (
    <div
      className="app-notification agent-island-card cove-pixel-window"
      data-testid={`app-notification-${id}`}
      data-island-card={cardKey}
      data-tucked={layout.isTucked ? 'true' : undefined}
      data-leaving={leaving ? 'true' : undefined}
      style={{
        transform: `translateY(${layout.y}px) scale(${layout.scale})`,
        height: layout.height ?? undefined,
        zIndex: layout.zIndex,
      }}
    >
      <div ref={innerRef} className="agent-island-card__inner">
        <Button
          variant="ghost"
          className="agent-island-card__main"
          onClick={() => onActivate(notification)}
        >
          <AgentActivityMark
            className="agent-activity-mark--lg"
            item={{
              workspaceId: notification.workspaceId,
              projectIconId: live?.projectIconId ?? null,
              provider: live?.provider ?? null,
            }}
          />
          <span className="agent-island-card__copy">
            <span className="app-notification__title agent-island-card__title">
              {notification.title}
            </span>
            <span className="agent-island-card__status">
              <span className="agent-island-card__light" aria-hidden="true" />
              {t('agentIsland.waitingForInput')}
            </span>
            <span className="agent-island-card__chips">
              <Chip
                testId="app-notification-chip-project"
                label={t('agentIsland.project')}
                value={notification.workspaceName}
                icon={
                  <ProjectIcon
                    iconId={live?.projectIconId ?? null}
                    className="agent-island-card__chip-icon"
                  />
                }
              />
              {contextVisibility.showTask && notification.taskTitle ? (
                <Chip
                  testId="app-notification-chip-task"
                  label={t('settingsPanel.nav.tasks')}
                  value={notification.taskTitle}
                  icon={<TaskIcon size={12} className="agent-island-card__chip-icon" />}
                />
              ) : null}
              {contextVisibility.showSpace && notification.spaceName ? (
                <Chip
                  testId="app-notification-chip-space"
                  label={t('commandCenter.sections.spaces')}
                  value={notification.spaceName}
                  icon={<GridIcon size={12} className="agent-island-card__chip-icon" />}
                />
              ) : null}
              {git ? (
                <Chip
                  testId="app-notification-chip-branch"
                  label={git.kind === 'branch' ? t('worktree.branch') : t('worktree.detached')}
                  value={git.kind === 'branch' ? git.name : git.shortHead}
                  isCode
                  icon={
                    git.kind === 'branch' ? (
                      <GitBranchIcon size={12} className="agent-island-card__chip-icon" />
                    ) : (
                      <GitCommitIcon size={12} className="agent-island-card__chip-icon" />
                    )
                  }
                />
              ) : null}
              {pullRequest ? (
                <Chip
                  testId="app-notification-chip-pr"
                  label="PR"
                  value={`#${pullRequest.number}`}
                  hint={`${pullRequest.title} (#${pullRequest.number})`}
                  isCode
                  icon={<GitPullRequestIcon size={12} className="agent-island-card__chip-icon" />}
                />
              ) : null}
            </span>
          </span>
        </Button>
        <IconButton
          label={t('common.close')}
          size="xs"
          className="agent-island-card__close"
          data-testid={`app-notification-close-${id}`}
          onClick={dismiss}
        >
          <CloseIcon size={12} />
        </IconButton>
        <span
          className="agent-island-card__countdown"
          data-paused={paused ? 'true' : 'false'}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
