import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  it('uses a native checkbox and reports the requested checked state', () => {
    const onCheckedChange = vi.fn()
    const { rerender } = render(
      <Toggle label="Show sidebar" checked={false} onCheckedChange={onCheckedChange} />,
    )

    const checkbox = screen.getByRole('switch', { name: 'Show sidebar' }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    rerender(<Toggle label="Show sidebar" checked onCheckedChange={onCheckedChange} />)
    expect(checkbox.checked).toBe(true)
  })

  it('associates supporting text and keeps disabled semantics', () => {
    const onCheckedChange = vi.fn()

    render(
      <>
        <p id="toggle-help">Keeps navigation visible.</p>
        <Toggle
          label="Show sidebar"
          describedBy="toggle-help"
          checked={false}
          disabled
          onCheckedChange={onCheckedChange}
          testId="sidebar-toggle"
        />
      </>,
    )

    const toggle = screen.getByTestId('sidebar-toggle')
    const checkbox = screen.getByRole('switch', { name: 'Show sidebar' }) as HTMLInputElement
    expect(toggle.contains(checkbox)).toBe(true)
    expect(checkbox.getAttribute('role')).toBe('switch')
    expect(checkbox.disabled).toBe(true)
    expect(checkbox.getAttribute('aria-describedby')).toBe('toggle-help')
    fireEvent.click(checkbox)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
