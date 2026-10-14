import React from 'react'
import { classNames } from './classNames'

/** Color roles, not states: callers map standby, exited and stopped to neutral. */
export type StatusPillTone = 'working' | 'waiting' | 'neutral' | 'failed'

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusPillTone
  children: React.ReactNode
}

/** The only place status colors appear as text: a pill that always says what the color means. */
export function StatusPill({
  tone,
  className,
  children,
  ...spanProps
}: StatusPillProps): React.JSX.Element {
  return (
    <span
      {...spanProps}
      data-cove-part="status-pill"
      data-tone={tone}
      className={classNames('cove-status-pill', className)}
    >
      {tone === 'working' ? (
        <span className="cove-status-pill__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {children}
    </span>
  )
}
