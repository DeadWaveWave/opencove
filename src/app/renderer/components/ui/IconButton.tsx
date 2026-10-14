import React from 'react'
import { classNames } from './classNames'
import { Tooltip } from './Tooltip'

export type IconButtonVariant = 'ghost' | 'secondary' | 'danger'
export type IconButtonSize = 'xs' | 'sm' | 'md'

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  label: string
  variant?: IconButtonVariant
  size?: IconButtonSize
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    variant = 'ghost',
    size = 'sm',
    type = 'button',
    title,
    className,
    children,
    ...buttonProps
  },
  forwardedRef,
) {
  const hint = title ?? label
  return (
    // The hint repeats the label unless a distinct title adds to it.
    <Tooltip content={hint} describe={hint !== label}>
      <button
        {...buttonProps}
        data-cove-part="icon-button"
        ref={forwardedRef}
        type={type}
        aria-label={label}
        className={classNames(
          'cove-icon-button',
          `cove-icon-button--${variant}`,
          `cove-icon-button--${size}`,
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
})
