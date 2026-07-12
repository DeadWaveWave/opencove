import React from 'react'
import { classNames } from './classNames'

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
  return (
    <button
      {...buttonProps}
      ref={forwardedRef}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={classNames(
        'cove-icon-button',
        `cove-icon-button--${variant}`,
        `cove-icon-button--${size}`,
        className,
      )}
    >
      {children}
    </button>
  )
})
