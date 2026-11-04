import React from 'react'
import { classNames } from './classNames'

export interface NumberInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> {
  /** Shown after the field, e.g. "px"; screen readers hear it as the field's description. */
  unit?: React.ReactNode
}

/** A compact number field for setting rows; SettingRow's label names it. */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput({ unit, className, 'aria-describedby': describedBy, ...inputProps }, ref) {
    const unitId = React.useId()
    const hasUnit = unit !== undefined && unit !== null
    const input = (
      <input
        {...inputProps}
        ref={ref}
        type="number"
        className={classNames('cove-field', 'cove-number-input__field', className)}
        aria-describedby={
          [describedBy, hasUnit ? unitId : undefined].filter(Boolean).join(' ') || undefined
        }
      />
    )
    if (!hasUnit) {
      return input
    }
    return (
      <span className="cove-number-input">
        {input}
        <span id={unitId} className="cove-number-input__unit">
          {unit}
        </span>
      </span>
    )
  },
)
