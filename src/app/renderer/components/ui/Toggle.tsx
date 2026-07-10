import React from 'react'
import { classNames } from './classNames'

export interface ToggleProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'aria-label' | 'checked' | 'className' | 'defaultChecked' | 'disabled' | 'onChange' | 'type'
> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  describedBy?: string
  testId?: string
  className?: string
}

function joinIdReferences(...values: Array<string | undefined>): string | undefined {
  const ids = values.flatMap(value => value?.split(/\s+/).filter(Boolean) ?? [])
  return ids.length > 0 ? [...new Set(ids)].join(' ') : undefined
}

export const Toggle = React.forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  {
    checked,
    onCheckedChange,
    disabled = false,
    label,
    describedBy,
    testId,
    className,
    'aria-describedby': ariaDescribedBy,
    ...inputProps
  },
  forwardedRef,
) {
  return (
    <span
      className={classNames('cove-toggle', className)}
      data-disabled={disabled ? '' : undefined}
      data-testid={testId}
    >
      <input
        {...inputProps}
        ref={forwardedRef}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-describedby={joinIdReferences(ariaDescribedBy, describedBy)}
        className="cove-toggle__input"
        onChange={event => onCheckedChange(event.currentTarget.checked)}
      />
      <span className="cove-toggle__track" aria-hidden="true">
        <span className="cove-toggle__thumb" />
      </span>
    </span>
  )
})
