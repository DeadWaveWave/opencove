import React from 'react'
import { classNames } from './classNames'

interface ControlAssociationProps {
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

interface SettingRowBaseProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'children' | 'role'
> {
  label: React.ReactNode
  description?: React.ReactNode
}

export type SettingRowProps = SettingRowBaseProps &
  (
    | {
        /** One form control; the label is its <label>, the description its description. */
        control: React.ReactElement
        value?: never
      }
    | {
        /** Read-only values or several actions; the row names them as a group. */
        value: React.ReactNode
        control?: never
      }
  )

function joinIdReferences(...values: Array<string | undefined>): string | undefined {
  const ids = values.flatMap(value => value?.split(/\s+/).filter(Boolean) ?? [])
  return ids.length > 0 ? [...new Set(ids)].join(' ') : undefined
}

export function SettingRow({
  label,
  description,
  control,
  value,
  className,
  ...rowProps
}: SettingRowProps): React.JSX.Element {
  const generatedId = React.useId()
  const labelId = `${generatedId}-label`
  const descriptionId =
    description === undefined || description === null ? undefined : `${generatedId}-description`
  const descriptionElement = descriptionId ? (
    <p id={descriptionId} className="cove-setting-row__description">
      {description}
    </p>
  ) : null

  if (!control) {
    return (
      <div
        {...rowProps}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className={classNames('cove-setting-row', 'cove-setting-row--value', className)}
      >
        <div className="cove-setting-row__copy">
          <span id={labelId} className="cove-setting-row__label">
            {label}
          </span>
          {descriptionElement}
        </div>
        <div className="cove-setting-row__control">{value}</div>
      </div>
    )
  }

  const typedControl = control as React.ReactElement<ControlAssociationProps>
  // Controls that are not labelable (a radio group) mark themselves; they get aria-labelledby only.
  const labelsGroup =
    typeof typedControl.type !== 'string' &&
    (typedControl.type as { settingRowLabel?: string }).settingRowLabel === 'group'
  const controlId = typedControl.props.id ?? `${generatedId}-control`
  const associatedControl = React.cloneElement(typedControl, {
    id: controlId,
    'aria-labelledby': joinIdReferences(typedControl.props['aria-labelledby'], labelId),
    'aria-describedby': joinIdReferences(typedControl.props['aria-describedby'], descriptionId),
  })

  return (
    <div {...rowProps} className={classNames('cove-setting-row', className)}>
      <div className="cove-setting-row__copy">
        {labelsGroup ? (
          <span id={labelId} className="cove-setting-row__label">
            {label}
          </span>
        ) : (
          <label id={labelId} className="cove-setting-row__label" htmlFor={controlId}>
            {label}
          </label>
        )}
        {descriptionElement}
      </div>
      <div className="cove-setting-row__control">{associatedControl}</div>
    </div>
  )
}
