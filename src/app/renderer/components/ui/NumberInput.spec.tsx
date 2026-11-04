import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NumberInput } from './NumberInput'
import { SettingRow } from './SettingRow'

describe('NumberInput', () => {
  it('is named by its setting row and described by the row and its unit', () => {
    const onChange = vi.fn()
    render(
      <SettingRow
        label="Interface font size"
        description="Text size across the app."
        control={<NumberInput value={13} min={11} max={18} unit="px" onChange={onChange} />}
      />,
    )

    const input = screen.getByRole('spinbutton', { name: 'Interface font size' })
    const description = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map(id => document.getElementById(id)?.textContent)
    expect(description).toEqual(['Text size across the app.', 'px'])
    fireEvent.change(input, { target: { value: '14' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('renders a bare field without a unit', () => {
    render(<NumberInput aria-label="Zoom" value={1} onChange={vi.fn()} />)
    const input = screen.getByRole('spinbutton', { name: 'Zoom' })
    expect(input.getAttribute('aria-describedby')).toBeNull()
    expect(input.parentElement?.classList.contains('cove-number-input')).toBe(false)
  })
})
