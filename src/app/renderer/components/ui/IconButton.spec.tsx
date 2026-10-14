import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { IconButton } from './IconButton'
import { resetTooltipsForTests } from './Tooltip'

beforeEach(() => {
  resetTooltipsForTests()
})

describe('IconButton', () => {
  it('names itself with its label and shows the label as a themed tooltip, not a native title', () => {
    render(
      <IconButton label="Close panel" size="xs" variant="danger">
        <svg aria-hidden="true" />
      </IconButton>,
    )

    const button = screen.getByRole('button', { name: 'Close panel' }) as HTMLButtonElement
    expect(button.type).toBe('button')
    expect(button).not.toHaveAttribute('title')
    expect(button.classList.contains('cove-icon-button--danger')).toBe(true)
    expect(button.classList.contains('cove-icon-button--xs')).toBe(true)

    fireEvent.focus(button)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close panel')
    // The tooltip repeats the name, so it does not also describe the button.
    expect(button).not.toHaveAttribute('aria-describedby')
  })

  it('shows a distinct title as the tooltip and describes the button with it', () => {
    render(
      <IconButton label="Refresh" title="Refresh preview (⌘R)">
        <svg aria-hidden="true" />
      </IconButton>,
    )

    const button = screen.getByRole('button', { name: 'Refresh' })
    expect(button).not.toHaveAttribute('title')
    fireEvent.focus(button)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh preview (⌘R)')
    expect(button).toHaveAccessibleDescription('Refresh preview (⌘R)')
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
