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
 * Every window header has the same anatomy: label dot, kind tile, title, status, drag space,
 * kind actions, collapse, close. Kinds fill the slots; the order and the controls stay shared.
 * A kind whose title moves the window (`titleIsDragSurface`) gives the drag space to the title.
 */
export function WindowHeader({
  className,
  kind,
  labelColor,
  icon,
  title,
  status,
  dragSurfaceTestId,
  titleIsDragSurface = false,
  actions,
  trailingClassName,
  close,
  onPointerDownCapture,
}: {
  className: string
  /** What the window is; colours its tile and tints the header. Never draws the frame. */
  kind: WindowKindFamily
  labelColor?: LabelColor | null
  /** The kind glyph; the tile around it is the header's. */
  icon: React.ReactNode
  title: React.ReactNode
  status?: React.ReactNode
  dragSurfaceTestId?: string
  /**
   * The title is the drag surface: a click on it renames, a hold or a drag moves the window
   * (InlineNodeTitleEditor `movesWindow`). The header keeps no drag space of its own; the tile is
   * the one spot that only grabs, so a click there selects the window, and it carries
   * `dragSurfaceTestId`.
   */
  titleIsDragSurface?: boolean
  actions?: React.ReactNode
  trailingClassName?: string
  close: WindowHeaderClose
  onPointerDownCapture?: (event: React.PointerEvent<HTMLElement>) => void
}): React.JSX.Element {
  const commitProbeRef = useWindowCommitProbe(kind, {
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
      data-cove-title-drag={titleIsDragSurface ? 'true' : undefined}
      onPointerDownCapture={onPointerDownCapture}
    >
      {labelColor ? (
        <span
          className="cove-label-dot cove-label-dot--solid"
          data-cove-label-color={labelColor}
          aria-hidden="true"
        />
      ) : null}
      <KindTile
        kind={kind}
        className="cove-window-header__tile"
        testId={titleIsDragSurface ? dragSurfaceTestId : undefined}
      >
        {icon}
      </KindTile>
      {title}
      {status ? <div className="cove-window-header__status">{status}</div> : null}
      {titleIsDragSurface ? null : (
        <div
          className="cove-window-header__drag"
          data-testid={dragSurfaceTestId}
          aria-hidden="true"
        />
      )}
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
