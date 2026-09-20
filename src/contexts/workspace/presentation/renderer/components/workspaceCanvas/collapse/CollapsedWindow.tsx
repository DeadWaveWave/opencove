import { useRef, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { TerminalNodeData } from '../../../types'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'
import { resolveAgentTreatedProvider } from '../../../utils/terminalAgentOverlay'
import { findLinkedTaskTitleForAgent, resolveAgentDisplayTitle } from '../../../utils/agentTitle'
import { NodeKindIcon } from '../../shared/NodeKindIcon'
import { resolveSpaceSummaryStatus } from '../view/spaceSummary'
import { useWorkspaceCollapse } from './WorkspaceCollapseContext'
import { useCollapsedTerminalActivity } from './useCollapsedTerminalActivity'

export function CollapsedWindow({
  id,
  data,
  message,
  onExpand,
  onClose,
  onToggleSelection,
  active = true,
}: {
  id: string
  data: TerminalNodeData
  message: string
  onExpand: () => void
  onClose: () => void
  onToggleSelection?: () => void
  active?: boolean
}) {
  const { t } = useTranslation()
  const collapse = useWorkspaceCollapse()
  const presentation = resolveAgentPresentation(data)
  const provider = resolveAgentTreatedProvider({ id, data, position: { x: 0, y: 0 } })
  const title =
    data.kind === 'agent' && data.agent && !data.titlePinnedByUser
      ? resolveAgentDisplayTitle({
          provider: data.agent.provider,
          linkedTaskTitle: findLinkedTaskTitleForAgent(
            collapse?.nodes ?? [],
            id,
            data.agent.taskId,
          ),
          fallbackTitle: data.title,
        })
      : data.title
  const status = resolveSpaceSummaryStatus(data, t)
  const animated = useAppStore(state => state.agentSettings.agentWorkingPixelEffectEnabled)
  const unavailable =
    presentation.observation?.degraded === true ||
    status?.state === 'restoring' ||
    data.status === 'restoring' ||
    Boolean(data.runtimeSessionBinding)
  const animateStatus = animated && !unavailable
  const iconRef = useRef<HTMLSpanElement>(null)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  useCollapsedTerminalActivity(
    data.sessionId,
    active && animateStatus && !presentation.isAgent && status?.state === 'connected',
    iconRef,
  )

  return (
    <div
      className={`cove-collapsed-window${presentation.isAgent ? ' cove-collapsed-window--agent' : ''}`}
      data-testid={`collapsed-node-${id}`}
      data-node-kind={data.kind}
      data-status={status?.state}
      data-animated={(active && animateStatus) || undefined}
    >
      <div
        role="button"
        tabIndex={active ? 0 : -1}
        className="cove-collapsed-window__launch"
        data-node-drag-handle={active ? 'true' : undefined}
        data-testid="node-expand"
        aria-disabled={!active || undefined}
        aria-label={`${t('canvasCollapse.expandWindow')}: ${title}`}
        aria-expanded="false"
        aria-controls={`cove-node-runtime-${id}`}
        onPointerDown={event => {
          pointerStart.current = active ? { x: event.clientX, y: event.clientY } : null
        }}
        onClick={event => {
          event.stopPropagation()
          const start = pointerStart.current
          pointerStart.current = null
          if (
            !active ||
            event.metaKey ||
            event.ctrlKey ||
            (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5)
          ) {
            return
          }
          if (event.shiftKey) {
            onToggleSelection?.()
            return
          }
          onExpand()
        }}
        onKeyDown={event => {
          if (active && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            event.stopPropagation()
            onExpand()
          }
        }}
      >
        <span ref={iconRef} className="cove-collapsed-window__icon" aria-hidden="true">
          {presentation.isAgent && provider ? (
            <AgentProviderIcon provider={provider} />
          ) : (
            <NodeKindIcon kind={data.kind} />
          )}
          <span className="cove-collapsed-window__pixels">
            {Array.from({ length: 4 }, (_, corner) => (
              <span key={corner} className="cove-collapsed-window__pixel-corner">
                {Array.from({ length: 7 }, (_pixel, index) => (
                  <i key={index} style={{ '--pixel-index': corner * 7 + index } as CSSProperties} />
                ))}
              </span>
            ))}
          </span>
        </span>
        <span className="cove-collapsed-window__title-slot">
          <span className="cove-collapsed-window__title" title={title}>
            {title}
          </span>
        </span>
        {status ? <span className="cove-collapsed-window__status">{status.label}</span> : null}
        {presentation.isAgent ? (
          <span
            className="cove-collapsed-window__message"
            aria-label={t('canvasCollapse.latestMessage')}
            title={message || undefined}
          >
            {message || t('canvasCollapse.waitingForMessage')}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={!active}
        className="cove-node-collapse-button cove-collapsed-window__close nodrag"
        aria-label={t('canvasCollapse.closeWindow')}
        title={t('canvasCollapse.closeWindow')}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation()
          onClose()
        }}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
