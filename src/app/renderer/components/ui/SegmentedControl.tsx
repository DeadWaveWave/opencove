import React from 'react'
import { classNames } from './classNames'
import { Tooltip } from './Tooltip'

export interface SegmentedControlOption<Value extends string> {
  value: Value
  label: string
  icon?: React.ReactNode
  /** Shows only the icon; the label still names the segment and appears as its tooltip. */
  iconOnly?: boolean
  disabled?: boolean
  testId?: string
}

export interface SegmentedControlProps<Value extends string> {
  value: Value
  options: ReadonlyArray<SegmentedControlOption<Value>>
  onValueChange: (value: Value) => void
  /** The group's name; pass `labelledBy` instead when a visible heading names it. */
  label?: string
  labelledBy?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
  testId?: string
  /** Set by SettingRow, which names and describes the group from its label and description. */
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/**
 * One choice out of a few, shown side by side. Segments are native radio inputs under one
 * unique name, so the group takes arrow keys and a single tab stop from the platform.
 */
export function SegmentedControl<Value extends string>({
  value,
  options,
  onValueChange,
  label,
  labelledBy,
  disabled = false,
  size = 'sm',
  className,
  testId,
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: SegmentedControlProps<Value>): React.JSX.Element {
  const name = React.useId()
  const groupLabelledBy = [labelledBy, ariaLabelledBy].filter(Boolean).join(' ') || undefined
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={groupLabelledBy ? undefined : label}
      aria-labelledby={groupLabelledBy}
      aria-describedby={ariaDescribedBy}
      data-cove-part="segmented-control"
      data-size={size}
      data-disabled={disabled ? '' : undefined}
      data-testid={testId}
      className={classNames('cove-segmented', className)}
    >
      {options.map(option => {
        const checked = option.value === value
        const segment = (
          <label
            key={option.value}
            className="cove-segmented__option"
            data-state={checked ? 'on' : 'off'}
            data-icon-only={option.iconOnly ? '' : undefined}
          >
            <input
              type="radio"
              className="cove-segmented__input"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled || option.disabled}
              aria-label={option.iconOnly ? option.label : undefined}
              data-testid={option.testId}
              onChange={() => onValueChange(option.value)}
            />
            {option.icon ? (
              <span className="cove-segmented__icon" aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            {option.iconOnly ? null : <span className="cove-segmented__label">{option.label}</span>}
          </label>
        )
        return option.iconOnly ? (
          <Tooltip key={option.value} content={option.label} describe={false}>
            {segment}
          </Tooltip>
        ) : (
          segment
        )
      })}
    </div>
  )
}

/** A radio group is not labelable: SettingRow names it with aria-labelledby instead of a <label>. */
SegmentedControl.settingRowLabel = 'group' as const
