import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('defaults to a non-submitting button and forwards its ref', () => {
    const ref = React.createRef<HTMLButtonElement>()

    render(<Button ref={ref}>Save</Button>)

    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(button.type).toBe('button')
    expect(button.classList.contains('cove-button--secondary')).toBe(true)
    expect(button.classList.contains('cove-button--md')).toBe(true)
    expect(ref.current).toBe(button)
  })

  it('supports an explicit submit type', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())

    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Continue</Button>
      </form>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('exposes loading state and prevents activation', () => {
    const onClick = vi.fn()

    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
