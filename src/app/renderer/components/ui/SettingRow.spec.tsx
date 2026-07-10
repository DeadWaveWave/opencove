import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingRow } from './SettingRow'
import { Toggle } from './Toggle'

describe('SettingRow', () => {
  it('associates its visible label and description with the control', () => {
    const onCheckedChange = vi.fn()

    render(
      <SettingRow
        label="Show minimap"
        description="Display an overview of the canvas."
        control={
          <Toggle label="Minimap preference" checked={false} onCheckedChange={onCheckedChange} />
        }
      />,
    )

    const checkbox = screen.getByRole('switch', { name: 'Show minimap' })
    const descriptionId = checkbox.getAttribute('aria-describedby')
    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe(
      'Display an overview of the canvas.',
    )

    fireEvent.click(screen.getByText('Show minimap'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('supports a row without a description', () => {
    render(
      <SettingRow
        label="Compact mode"
        control={<Toggle label="Compact mode" checked={false} onCheckedChange={vi.fn()} />}
      />,
    )

    expect(
      screen.getByRole('switch', { name: 'Compact mode' }).getAttribute('aria-describedby'),
    ).toBeNull()
  })
})
