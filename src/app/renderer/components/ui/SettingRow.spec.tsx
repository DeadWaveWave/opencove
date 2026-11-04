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

  it('names a group of values or actions that is not one form control', () => {
    render(
      <SettingRow
        label="Updates"
        description="Check for a newer version."
        value={
          <>
            <span>1.2.0</span>
            <button type="button">Check now</button>
          </>
        }
      />,
    )

    const group = screen.getByRole('group', { name: 'Updates' })
    expect(group.textContent).toContain('1.2.0')
    expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Check for a newer version.',
    )
    // There is no single control to focus, so the name is not a <label>.
    expect(screen.getByText('Updates').tagName).toBe('SPAN')
    expect(screen.getByRole('button', { name: 'Check now' })).not.toBeNull()
  })

  it('passes row attributes such as an id to the row', () => {
    render(<SettingRow id="settings-version" label="Version" value="1.2.0" />)
    expect(document.getElementById('settings-version')?.classList).toContain('cove-setting-row')
  })
})
