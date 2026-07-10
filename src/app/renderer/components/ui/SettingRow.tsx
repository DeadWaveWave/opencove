import React from 'react'
import { classNames } from './classNames'

interface ControlAssociationProps {
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

export interface SettingRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode
  description?: React.ReactNode
  control: React.ReactElement
}

function joinIdReferences(...values: Array<string | undefined>): string | undefined {
  const ids = values.flatMap(value => value?.split(/\s+/).filter(Boolean) ?? [])
  return ids.length > 0 ? [...new Set(ids)].join(' ') : undefined
}

export function SettingRow({
  label,
  description,
  control,
  className,
  ...rowProps
}: SettingRowProps): React.JSX.Element {
  const generatedId = React.useId()
  const labelId = `${generatedId}-label`
  const descriptionId =
    description === undefined || description === null ? undefined : `${generatedId}-description`
  const typedControl = control as React.ReactElement<ControlAssociationProps>
  const controlId = typedControl.props.id ?? `${generatedId}-control`
  const associatedControl = React.cloneElement(typedControl, {
    id: controlId,
    'aria-labelledby': joinIdReferences(typedControl.props['aria-labelledby'], labelId),
    'aria-describedby': joinIdReferences(typedControl.props['aria-describedby'], descriptionId),
  })

  return (
    <div {...rowProps} className={classNames('cove-setting-row', className)}>
      <div className="cove-setting-row__copy">
        <label id={labelId} className="cove-setting-row__label" htmlFor={controlId}>
          {label}
        </label>
        {descriptionId ? (
          <p id={descriptionId} className="cove-setting-row__description">
            {description}
          </p>
        ) : null}
      </div>
      <div className="cove-setting-row__control">{associatedControl}</div>
    </div>
  )
}
