import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('uses its required label as the accessible name and fallback title', () => {
    render(
      <IconButton label="Close panel" size="xs" variant="danger">
        <svg aria-hidden="true" />
      </IconButton>,
    )

    const button = screen.getByRole('button', { name: 'Close panel' }) as HTMLButtonElement
    expect(button.type).toBe('button')
    expect(button.title).toBe('Close panel')
    expect(button.classList.contains('cove-icon-button--danger')).toBe(true)
    expect(button.classList.contains('cove-icon-button--xs')).toBe(true)
  })

  it('keeps native disabled semantics', () => {
    render(
      <IconButton label="Refresh" disabled>
        <svg aria-hidden="true" />
      </IconButton>,
    )

    const button = screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
