import React from 'react'
import { Check } from 'lucide-react'
import { classNames } from './classNames'

export interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'checked' | 'children' | 'className' | 'defaultChecked' | 'onChange' | 'type'
> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** The label; clicking it toggles the box. */
  children: React.ReactNode
  description?: React.ReactNode
  className?: string
}

/**
 * A themed native checkbox for options that are chosen, not switched on: the input keeps native
 * semantics and keyboard behaviour and covers a 24px target; the box is drawn from tokens.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, onCheckedChange, children, description, className, disabled = false, ...inputProps },
  forwardedRef,
) {
  const id = React.useId()
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`
  return (
    <label
      data-cove-part="checkbox"
      className={classNames('cove-checkbox', className)}
      data-disabled={disabled ? '' : undefined}
    >
      <span className="cove-checkbox__control">
        <input
          {...inputProps}
          ref={forwardedRef}
          type="checkbox"
          className="cove-checkbox__input"
          checked={checked}
          disabled={disabled}
          // The wrapping label would also read the description into the name.
          aria-labelledby={inputProps['aria-labelledby'] ?? labelId}
          aria-describedby={description ? descriptionId : inputProps['aria-describedby']}
          onChange={event => onCheckedChange(event.currentTarget.checked)}
        />
        <span className="cove-checkbox__box" aria-hidden="true">
          <Check className="cove-checkbox__check" />
        </span>
      </span>
      <span className="cove-checkbox__text">
        <span id={labelId} className="cove-checkbox__label">
          {children}
        </span>
        {description ? (
          <span id={descriptionId} className="cove-checkbox__description">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
})
