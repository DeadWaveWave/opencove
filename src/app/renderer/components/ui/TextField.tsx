import React from 'react'
import { classNames } from './classNames'

interface FieldFrameOwnProps {
  /** The visible label; it names the control. */
  label: React.ReactNode
  /** Sits at the end of the label row, e.g. an IconButton that fills the field. */
  labelAccessory?: React.ReactNode
  description?: React.ReactNode
  /** Marks the control invalid and describes what to fix. */
  error?: React.ReactNode
  size?: 'md' | 'compact'
  /** Applies to the field wrapper; `controlClassName` applies to the input itself. */
  className?: string
  controlClassName?: string
}

interface FieldIds {
  controlId: string
  descriptionId: string
  errorId: string
}

function useFieldIds(id: string | undefined): FieldIds {
  const generated = React.useId()
  const controlId = id ?? generated
  return {
    controlId,
    descriptionId: `${controlId}-description`,
    errorId: `${controlId}-error`,
  }
}

function joinIds(...ids: Array<string | false | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(' ')
  return joined.length > 0 ? joined : undefined
}

function controlAria(
  ids: FieldIds,
  { description, error }: Pick<FieldFrameOwnProps, 'description' | 'error'>,
  ownDescribedBy: string | undefined,
) {
  return {
    'aria-invalid': error ? true : undefined,
    'aria-errormessage': error ? ids.errorId : undefined,
    // The error also joins the description: aria-errormessage is not read everywhere yet.
    'aria-describedby': joinIds(
      ownDescribedBy,
      Boolean(description) && ids.descriptionId,
      Boolean(error) && ids.errorId,
    ),
  } as const
}

function FieldFrame({
  ids,
  label,
  labelAccessory,
  description,
  error,
  className,
  children,
}: Omit<FieldFrameOwnProps, 'size' | 'controlClassName'> & {
  ids: FieldIds
  children: React.ReactNode
}): React.JSX.Element {
  const labelElement = (
    <label htmlFor={ids.controlId} className="cove-text-field__label">
      {label}
    </label>
  )
  return (
    <div
      data-cove-part="text-field"
      data-invalid={error ? '' : undefined}
      className={classNames('cove-text-field', className)}
    >
      {labelAccessory ? (
        <div className="cove-text-field__label-row">
          {labelElement}
          {labelAccessory}
        </div>
      ) : (
        labelElement
      )}
      {children}
      {description ? (
        <p id={ids.descriptionId} className="cove-text-field__description">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={ids.errorId} className="cove-text-field__error">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export interface TextFieldProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'>,
    FieldFrameOwnProps {}

/** A labelled single-line field: the label, help and error are wired to the input. */
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    id,
    label,
    labelAccessory,
    description,
    error,
    size = 'md',
    className,
    controlClassName,
    type = 'text',
    'aria-describedby': ownDescribedBy,
    ...inputProps
  },
  forwardedRef,
) {
  const ids = useFieldIds(id)
  return (
    <FieldFrame
      ids={ids}
      label={label}
      labelAccessory={labelAccessory}
      description={description}
      error={error}
      className={className}
    >
      <input
        {...inputProps}
        {...controlAria(ids, { description, error }, ownDescribedBy)}
        ref={forwardedRef}
        id={ids.controlId}
        type={type}
        className={classNames(
          'cove-field',
          size === 'compact' && 'cove-field--compact',
          'cove-text-field__control',
          controlClassName,
        )}
      />
    </FieldFrame>
  )
})

export interface TextAreaFieldProps
  extends
    Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>,
    FieldFrameOwnProps {}

/** A labelled multi-line field. */
export const TextAreaField = React.forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    {
      id,
      label,
      labelAccessory,
      description,
      error,
      size = 'md',
      className,
      controlClassName,
      'aria-describedby': ownDescribedBy,
      ...textareaProps
    },
    forwardedRef,
  ) {
    const ids = useFieldIds(id)
    return (
      <FieldFrame
        ids={ids}
        label={label}
        labelAccessory={labelAccessory}
        description={description}
        error={error}
        className={className}
      >
        <textarea
          {...textareaProps}
          {...controlAria(ids, { description, error }, ownDescribedBy)}
          ref={forwardedRef}
          id={ids.controlId}
          className={classNames(
            'cove-field',
            size === 'compact' && 'cove-field--compact',
            'cove-text-field__control',
            'cove-text-field__control--multiline',
            controlClassName,
          )}
        />
      </FieldFrame>
    )
  },
)
