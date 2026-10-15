import React from 'react'
import { Check } from 'lucide-react'
import { classNames } from './classNames'

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Set for a chip that can be selected: it becomes a toggle button. */
  selected?: boolean
  onSelectedChange?: (selected: boolean) => void
  icon?: React.ReactNode
}

/**
 * A compact label for tags and filters. Selectable chips toggle with aria-pressed and show a check
 * while selected, so the state never rests on color alone.
 */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, onSelectedChange, icon, className, children, onClick, ...buttonProps },
  forwardedRef,
) {
  const selectable = selected !== undefined
  const leading = selected ? <Check /> : icon
  return (
    <button
      {...buttonProps}
      ref={forwardedRef}
      type="button"
      data-cove-part="chip"
      aria-pressed={selectable ? selected : undefined}
      data-state={selectable ? (selected ? 'on' : 'off') : undefined}
      className={classNames('cove-chip', className)}
      onClick={event => {
        onClick?.(event)
        if (selectable && !event.defaultPrevented) {
          onSelectedChange?.(!selected)
        }
      }}
    >
      {leading ? (
        <span className="cove-chip__icon" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="cove-chip__label">{children}</span>
    </button>
  )
})
