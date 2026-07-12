import React from 'react'
import { classNames } from './classNames'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled = false,
    type = 'button',
    className,
    children,
    'aria-busy': ariaBusy,
    ...buttonProps
  },
  forwardedRef,
) {
  return (
    <button
      {...buttonProps}
      ref={forwardedRef}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? true : ariaBusy}
      data-loading={loading ? '' : undefined}
      className={classNames(
        'cove-button',
        `cove-button--${variant}`,
        `cove-button--${size}`,
        className,
      )}
    >
      {loading ? <span className="cove-button__spinner" aria-hidden="true" /> : null}
      <span className="cove-button__content">{children}</span>
    </button>
  )
})
