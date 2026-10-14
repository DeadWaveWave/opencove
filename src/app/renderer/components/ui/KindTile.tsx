import React from 'react'
import { classNames } from './classNames'

export type KindTileFamily = 'ai' | 'shell' | 'plan' | 'knowledge' | 'media' | 'neutral'

export interface KindTileProps {
  kind: KindTileFamily
  size?: 'sm' | 'md'
  className?: string
  /** The kind's icon. The tile is decorative: the window title names it. */
  children: React.ReactNode
}

/** The window kind's icon on its family tint: the only place kind colors meet an icon. */
export function KindTile({
  kind,
  size = 'md',
  className,
  children,
}: KindTileProps): React.JSX.Element {
  return (
    <span
      data-cove-part="kind-tile"
      data-kind={kind}
      data-size={size}
      aria-hidden="true"
      className={classNames('cove-kind-tile', className)}
    >
      {children}
    </span>
  )
}
