import React from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { KindTile } from '@app/renderer/components/ui/KindTile'
import { Popover } from '@app/renderer/components/ui/Popover'
import { useTranslation } from '@app/renderer/i18n'
import { NodeKindIcon } from '@contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'
import type { AgentActivitySummary } from '../utils/agentActivitySummary'
import { AgentActivityList, focusFirstAgentActivityRow } from './AgentActivityList'

const HOVER_OPEN_DELAY_MS = 150
// The pointer may cross a gap on its way from the pill into the list.
const HOVER_CLOSE_DELAY_MS = 300
const MAX_MARKS = 3

/** How the list opened: a hover only previews it; a click or the keyboard keeps it. */
type OpenedBy = 'hover' | 'pointer' | 'keyboard'

/**
 * The top bar's agent pill: how many agents wait for you (amber, with their marks) or work
 * (neutral). Hovering it, clicking it or pressing Enter on it opens every agent as a list; any
 * line jumps to its agent. The pill is hidden while no agent waits or works.
 */
export function AppHeaderAgentActivity({
  summary,
  pillRef: externalPillRef,
  isOpen,
  onOpenChange,
  canPreviewOnHover = true,
  onFocusAgent,
}: {
  summary: AgentActivitySummary
  /** The pill's element, for the island's cards to grow out of. */
  pillRef?: React.RefObject<HTMLButtonElement | null>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** False while another top-bar panel is open: only a click may replace it. */
  canPreviewOnHover?: boolean
  onFocusAgent: (workspaceId: string, nodeId: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const ownPillRef = React.useRef<HTMLButtonElement | null>(null)
  const pillRef = externalPillRef ?? ownPillRef
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [openedBy, setOpenedBy] = React.useState<OpenedBy>('pointer')
  const focusFirstRowRef = React.useRef(false)
  const timerRef = React.useRef<number | null>(null)
  const isEmpty = summary.waiting.length === 0 && summary.working.length === 0

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])
  React.useEffect(() => clearTimer, [clearTimer])

  const open = React.useCallback(
    (by: OpenedBy) => {
      clearTimer()
      setOpenedBy(by)
      onOpenChange(true)
    },
    [clearTimer, onOpenChange],
  )
  const close = React.useCallback(() => {
    clearTimer()
    onOpenChange(false)
  }, [clearTimer, onOpenChange])

  // A list opened from the keyboard takes focus on its first line. The popover stays hidden
  // until it is placed, and a hidden line cannot take focus, so the focus waits a task.
  React.useEffect(() => {
    if (!isOpen || !focusFirstRowRef.current) {
      return
    }
    focusFirstRowRef.current = false
    const focusTimer = window.setTimeout(() => focusFirstAgentActivityRow(listRef.current), 0)
    return () => window.clearTimeout(focusTimer)
  }, [isOpen])

  // Nothing left to list: the pill goes, and the list with it.
  React.useEffect(() => {
    if (isEmpty && isOpen) {
      close()
    }
  }, [close, isEmpty, isOpen])

  if (isEmpty) {
    return null
  }

  const openFromKeyboard = () => {
    if (isOpen) {
      clearTimer()
      setOpenedBy('keyboard')
      focusFirstAgentActivityRow(listRef.current)
      return
    }
    focusFirstRowRef.current = true
    open('keyboard')
  }

  const scheduleHoverClose = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse' || openedBy !== 'hover') {
      return
    }
    clearTimer()
    timerRef.current = window.setTimeout(close, HOVER_CLOSE_DELAY_MS)
  }

  const isWaiting = summary.waiting.length > 0
  const marks = (isWaiting ? summary.waiting : []).slice(0, MAX_MARKS)

  return (
    <>
      <Button
        ref={pillRef}
        variant="ghost"
        size="sm"
        className="app-header__agent-activity agent-activity-pill"
        data-testid="app-header-agent-activity"
        data-tone={isWaiting ? 'waiting' : 'working'}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={
          isWaiting
            ? t('agentActivity.pillWaiting', { count: summary.waiting.length })
            : t('agentActivity.pillWorking', { count: summary.working.length })
        }
        onPointerEnter={event => {
          if (event.pointerType !== 'mouse') {
            return
          }
          clearTimer()
          if (!isOpen && canPreviewOnHover) {
            timerRef.current = window.setTimeout(() => open('hover'), HOVER_OPEN_DELAY_MS)
          }
        }}
        onPointerLeave={event => {
          if (event.pointerType !== 'mouse') {
            return
          }
          if (!isOpen) {
            clearTimer()
            return
          }
          scheduleHoverClose(event)
        }}
        onClick={event => {
          // Enter and Space click a button with no pointer behind it (detail 0).
          const by: OpenedBy = event.detail === 0 ? 'keyboard' : 'pointer'
          if (isOpen && openedBy !== 'hover') {
            close()
            return
          }
          // Closed, or only previewed by a hover: the list opens for good.
          if (by === 'keyboard') {
            openFromKeyboard()
          } else {
            open(by)
          }
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            openFromKeyboard()
          }
        }}
      >
        {isWaiting ? (
          <span className="agent-activity-pill__marks" aria-hidden="true">
            {marks.map(item => (
              <KindTile key={`${item.workspaceId}:${item.nodeId}`} kind="ai" size="sm">
                <NodeKindIcon kind="agent" provider={item.provider} />
              </KindTile>
            ))}
          </span>
        ) : (
          <span className="cove-status-pill__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <span className="agent-activity-pill__label">
          {isWaiting
            ? t('appHeader.agentsWaiting', { count: summary.waiting.length })
            : t('appHeader.agentsWorking', { count: summary.working.length })}
        </span>
      </Button>
      <Popover
        ref={listRef}
        open={isOpen}
        anchorRef={pillRef}
        side="bottom"
        align="end"
        className="cove-pixel-window agent-activity-list"
        data-testid="app-header-agent-activity-list"
        aria-label={t('agentActivity.title')}
        // A hover only previews: Escape stays with whatever has focus, and focus stays put.
        dismissOnEscape={openedBy !== 'hover'}
        returnFocus={openedBy === 'hover' ? false : undefined}
        onDismiss={close}
        onPointerEnter={() => clearTimer()}
        onPointerLeave={scheduleHoverClose}
      >
        <AgentActivityList
          summary={summary}
          onSelect={item => {
            close()
            onFocusAgent(item.workspaceId, item.nodeId)
          }}
        />
      </Popover>
    </>
  )
}
