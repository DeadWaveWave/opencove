import React from 'react'
import { classNames } from './classNames'

export interface ToggleTileProps {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  /** A pixel icon; it is decorative, the label names the tile. */
  icon: React.ReactNode
  label: string
  disabled?: boolean
  /** Extra words for assistive technology, such as why the tile is disabled. */
  description?: string
  testId?: string
  className?: string
}

/**
 * A quick switch drawn as a pixel tile, as in a control center: a square face with the icon and a
 * light, the name underneath. On fills the face with the accent and lights the light. The name
 * stays the same either way; the state is the face, not the words.
 */
export function ToggleTile({
  pressed,
  onPressedChange,
  icon,
  label,
  disabled = false,
  description,
  testId,
  className,
}: ToggleTileProps): React.JSX.Element {
  const descriptionId = React.useId()
  return (
    <button
      type="button"
      data-cove-part="toggle-tile"
      className={classNames('cove-toggle-tile', className)}
      data-state={pressed ? 'on' : 'off'}
      data-testid={testId}
      aria-pressed={pressed}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
    >
      <span className="cove-toggle-tile__face" aria-hidden="true">
        <span className="cove-toggle-tile__icon">{icon}</span>
        <span className="cove-toggle-tile__light" />
      </span>
      <span className="cove-toggle-tile__label">{label}</span>
      {description ? (
        <span id={descriptionId} hidden>
          {description}
        </span>
      ) : null}
    </button>
  )
}
