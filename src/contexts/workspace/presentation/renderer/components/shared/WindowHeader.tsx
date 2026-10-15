import type React from 'react'
import { KindTile } from '@app/renderer/components/ui/KindTile'
import { classNames } from '@app/renderer/components/ui/classNames'
import type { LabelColor } from '@shared/types/labelColor'
import { WindowCloseButton } from './WindowCloseButton'
import { WindowCollapseButton } from './WindowCollapseButton'

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
 */
export function WindowHeader({
  className,
  labelColor,
  icon,
  title,
  status,
  dragSurfaceTestId,
  actions,
  trailingClassName,
  close,
  onPointerDownCapture,
}: {
  className: string
  labelColor?: LabelColor | null
  /** The kind glyph; the tile around it is the header's. */
  icon: React.ReactNode
  title: React.ReactNode
  status?: React.ReactNode
  dragSurfaceTestId?: string
  actions?: React.ReactNode
  trailingClassName?: string
  close: WindowHeaderClose
  onPointerDownCapture?: (event: React.PointerEvent<HTMLElement>) => void
}): React.JSX.Element {
  return (
    <header
      className={classNames('cove-window-header', className)}
      data-cove-part="window-header"
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
      {/* Kind colors arrive with the kind and label channels (Tide phase 3). */}
      <KindTile kind="neutral" className="cove-window-header__tile">
        {icon}
      </KindTile>
      {title}
      {status ? <div className="cove-window-header__status">{status}</div> : null}
      <div
        className="cove-window-header__drag"
        data-testid={dragSurfaceTestId}
        aria-hidden="true"
      />
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
