import type { JSX, ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { NodeFrame, Point, Size, WorkspaceNodeKind } from '../../types'
import { useNodeFrameResize } from '../../utils/nodeFrameResize'
import { resolveCanonicalNodeMinSize } from '../../utils/workspaceNodeSizing'
import { NodeKindIcon } from './NodeKindIcon'
import { NodeResizeHandles } from './NodeResizeHandles'
import { WindowCollapseButton } from './WindowCollapseButton'

export interface CanvasNodeWindowProps {
  id: string
  title: string
  nodeKind?: WorkspaceNodeKind
  pluginId?: string
  icon?: ReactNode
  subtitle?: ReactNode
  headerActions?: ReactNode
  children: ReactNode
  position: Point
  width: number
  height: number
  minSize?: Size
  className?: string
  testIdPrefix?: string
  closeLabel?: string
  onClose: () => void
  onResize: (frame: NodeFrame) => void
  onInteractionStart?: (options: { shiftKey: boolean }) => void
}

/** The host owns window geometry and chrome; plugins contribute content and actions. */
export function CanvasNodeWindow({
  id,
  title,
  nodeKind = 'plugin',
  pluginId,
  icon,
  subtitle,
  headerActions,
  children,
  position,
  width,
  height,
  minSize,
  className,
  testIdPrefix = 'canvas-window',
  closeLabel,
  onClose,
  onResize,
  onInteractionStart,
}: CanvasNodeWindowProps): JSX.Element {
  const { t } = useTranslation()
  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: minSize ?? resolveCanonicalNodeMinSize(nodeKind),
    onResize,
  })
  const frame = draftFrame ?? { position, size: { width, height } }
  const resolvedCloseLabel = closeLabel ?? t('canvasCollapse.closeWindow')

  return (
    <section
      data-cove-part="window"
      data-cove-kind={nodeKind}
      className={['cove-canvas-node-window', className].filter(Boolean).join(' ')}
      data-testid={`${testIdPrefix}-node-${id}`}
      aria-label={title}
      style={{
        width: frame.size.width,
        height: frame.size.height,
        transform:
          frame.position.x !== position.x || frame.position.y !== position.y
            ? `translate(${frame.position.x - position.x}px, ${frame.position.y - position.y}px)`
            : undefined,
      }}
      onPointerDown={event => {
        if (
          event.button === 0 &&
          !(event.target instanceof Element && event.target.closest('.nodrag'))
        ) {
          onInteractionStart?.({ shiftKey: event.shiftKey })
        }
      }}
    >
      <header
        className="cove-canvas-node-window__header"
        data-cove-part="window-header"
        data-node-drag-handle="true"
      >
        {icon ? (
          <span className="cove-node-kind-icon" aria-hidden="true">
            {icon}
          </span>
        ) : (
          <NodeKindIcon kind={nodeKind} pluginId={pluginId} />
        )}
        <span
          className="cove-canvas-node-window__title"
          data-cove-part="window-title"
          title={title}
        >
          {title}
        </span>
        {subtitle ? <span className="cove-canvas-node-window__subtitle">{subtitle}</span> : null}
        <div
          className="cove-canvas-node-window__actions nodrag"
          onPointerDown={event => event.stopPropagation()}
        >
          {headerActions}
          <WindowCollapseButton onClose={onClose} />
          <button
            type="button"
            className="cove-canvas-node-window__action"
            data-testid={`${testIdPrefix}-close`}
            aria-label={resolvedCloseLabel}
            title={resolvedCloseLabel}
            onClick={event => {
              event.stopPropagation()
              onClose()
            }}
          >
            <X size={15} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div
        className="cove-canvas-node-window__body nodrag nowheel"
        data-cove-part="window-body"
        onWheel={event => event.stopPropagation()}
      >
        {children}
      </div>
      <NodeResizeHandles
        classNamePrefix="task-node"
        testIdPrefix={`${testIdPrefix}-resizer`}
        includeTop
        handleResizePointerDown={handleResizePointerDown}
      />
    </section>
  )
}
