import type React from 'react'
import { KindTile } from '@app/renderer/components/ui/KindTile'
import { classNames } from '@app/renderer/components/ui/classNames'
import type { LabelColor } from '@shared/types/labelColor'
import type { WindowKindFamily } from '../../utils/windowKindFamily'
import { WindowCloseButton } from './WindowCloseButton'
import { WindowCollapseButton } from './WindowCollapseButton'
import { useWindowCommitProbe } from './windowCommitProbe'

export interface WindowHeaderClose {
  /** What closing does: close, delete note, delete task. */
  label: string
  /** The window's own close guard (confirmations, unsaved changes). */
  onClose: () => void
  /** Expands a collapsed window before its close prompt. */
  revealBeforeClose?: boolean
  className?: string
  testId?: string
  onPointerDown?: () => void
}

/**
 * Every window header has the same anatomy: label dot, kind tile, title, status, kind actions,
 * collapse, close. Kinds fill the slots; the order and the controls stay shared. The bar is the
 * drag surface and keeps no drag space of its own: the title runs to the controls. A title that
 * renames (InlineNodeTitleEditor) renames on a click and moves the window on a hold or a drag;
 * plain words select on a click. The tile is the one spot that only grabs.
 */
export function WindowHeader({
  className,
  kind,
  labelColor,
  icon,
  title,
  status,
  dragSurfaceTestId,
  actions,
  trailingClassName,
  close,
  onPointerDownCapture,
  commitProbeState,
}: {
  className: string
  /** What the window is; colours its tile and tints the header. Never draws the frame. */
  kind: WindowKindFamily
  labelColor?: LabelColor | null
  /** The kind glyph; the tile around it is the header's. */
  icon: React.ReactNode
  title: React.ReactNode
  status?: React.ReactNode
  /** Names the tile, the one spot that only grabs, for tests that drag the window. */
  dragSurfaceTestId?: string
  actions?: React.ReactNode
  trailingClassName?: string
  close: WindowHeaderClose
  onPointerDownCapture?: (event: React.PointerEvent<HTMLElement>) => void
  /** Local presentation state attributed by the test-only commit probe. */
  commitProbeState?: Record<string, unknown>
}): React.JSX.Element {
  const commitProbeRef = useWindowCommitProbe(kind, {
    ...commitProbeState,
    className,
    kind,
    labelColor,
    icon,
    title,
    status,
    actions,
    close,
    onPointerDownCapture,
  })
  return (
    <header
      ref={commitProbeRef}
      className={classNames('cove-window-header', className)}
      data-cove-part="window-header"
      data-cove-kind={kind}
      data-node-drag-handle="true"
      onPointerDownCapture={onPointerDownCapture}
    >
      {labelColor ? (
        <span
          className="cove-label-dot cove-label-dot--solid"
          data-cove-label-color={labelColor}
          aria-hidden="true"
        />
      ) : null}
      <KindTile kind={kind} className="cove-window-header__tile" testId={dragSurfaceTestId}>
        {icon}
      </KindTile>
      {title}
      {status ? <div className="cove-window-header__status">{status}</div> : null}
      <div className={classNames('cove-window-header__trailing nodrag', trailingClassName)}>
        {actions}
        <WindowCollapseButton onClose={close.onClose} revealBeforeClose={close.revealBeforeClose} />
        <WindowCloseButton
          label={close.label}
          className={close.className}
          data-testid={close.testId}
          onPointerDown={close.onPointerDown ? () => close.onPointerDown?.() : undefined}
          onClose={close.onClose}
        />
      </div>
    </header>
  )
}
