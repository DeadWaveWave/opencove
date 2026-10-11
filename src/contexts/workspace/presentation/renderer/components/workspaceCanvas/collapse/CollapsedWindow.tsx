import { useRef, type CSSProperties } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { TerminalNodeData } from '../../../types'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'
import { getCollapsedNodeSize } from '../../../utils/canvasCollapse'
import { resolveAgentTreatedProvider } from '../../../utils/terminalAgentOverlay'
import { findLinkedTaskTitleForAgent, resolveAgentDisplayLabel } from '../../../utils/agentTitle'
import { NodeKindIcon } from '../../shared/NodeKindIcon'
import { resolveSpaceSummaryStatus } from '../view/spaceSummary'
import { useWorkspaceCollapse } from './WorkspaceCollapseContext'
import { useCollapsedTerminalActivity } from './useCollapsedTerminalActivity'
import { useCompactThemeMotion } from './useCompactThemeMotion'

export function CollapsedWindow({
  id,
  data,
  onExpand,
  onToggleSelection,
  onContextMenu,
  active = true,
}: {
  id: string
  data: TerminalNodeData
  onExpand: () => void
  onToggleSelection?: () => void
  onContextMenu?: (point: { x: number; y: number }) => void
  active?: boolean
}) {
  const { t } = useTranslation()
  const collapse = useWorkspaceCollapse()
  const presentation = resolveAgentPresentation(data)
  const provider = resolveAgentTreatedProvider({ id, data, position: { x: 0, y: 0 } })
  const title =
    presentation.isAgent && provider
      ? resolveAgentDisplayLabel({
          provider,
          linkedTaskTitle:
            data.kind === 'agent' && data.agent
              ? findLinkedTaskTitleForAgent(collapse?.nodes ?? [], id, data.agent.taskId ?? null)
              : null,
          fallbackTitle: data.title,
          preferFallbackTitle: data.titlePinnedByUser === true,
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
  const motion = useCompactThemeMotion(
    iconRef,
    id,
    active &&
      animateStatus &&
      (status?.state === 'running' || (!presentation.isAgent && status?.state === 'connected')),
    status?.state === 'running',
  )
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  useCollapsedTerminalActivity(
    data.sessionId,
    motion.allowed && !presentation.isAgent && status?.state === 'connected',
    iconRef,
  )

  return (
    <div
      className="cove-collapsed-window"
      data-cove-part="compact-window"
      style={{ ...getCollapsedNodeSize(), ...motion.style }}
      data-testid={`collapsed-node-${id}`}
      data-node-kind={data.kind}
      data-status={status?.state}
      data-animated={motion.pixel || undefined}
      onContextMenu={event => {
        if (!active || !onContextMenu) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        pointerStart.current = null
        onContextMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <div
        role="button"
        tabIndex={active ? 0 : -1}
        className="cove-collapsed-window__launch"
        data-node-drag-handle={active ? 'true' : undefined}
        data-testid="node-expand"
        aria-disabled={!active || undefined}
        aria-label={`${t('canvasCollapse.expandWindow')}: ${title}`}
        aria-description={status?.label}
        title={status?.label}
        aria-expanded="false"
        aria-controls={`cove-node-runtime-${id}`}
        onPointerDown={event => {
          pointerStart.current =
            active && event.button === 0 ? { x: event.clientX, y: event.clientY } : null
        }}
        onClick={event => {
          event.stopPropagation()
          const start = pointerStart.current
          pointerStart.current = null
          if (
            !active ||
            event.button !== 0 ||
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
          if (
            active &&
            onContextMenu &&
            (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
          ) {
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            onContextMenu({ x: rect.left + rect.width / 2, y: rect.bottom })
            return
          }
          if (active && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            event.stopPropagation()
            onExpand()
          }
        }}
      >
        <span
          ref={iconRef}
          className="cove-collapsed-window__icon"
          data-cove-part="compact-base"
          aria-hidden="true"
        >
          {presentation.isAgent && provider ? (
            <AgentProviderIcon provider={provider} />
          ) : (
            <NodeKindIcon
              kind={data.kind}
              filePath={data.document?.uri ?? data.folder?.uri}
              pluginId={data.plugin?.pluginId}
            />
          )}
          <span className="cove-collapsed-window__pixels" data-cove-part="compact-pixels">
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
          <span
            className="cove-collapsed-window__title"
            data-cove-part="compact-title"
            title={title}
          >
            {title}
          </span>
        </span>
      </div>
    </div>
  )
}
