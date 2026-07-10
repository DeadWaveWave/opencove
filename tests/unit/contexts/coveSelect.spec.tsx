import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CoveSelect } from '../../../src/app/renderer/components/CoveSelect'
import { Dialog } from '../../../src/app/renderer/components/ui/Dialog'

function renderHarness(disabled = false) {
  function Harness(): React.JSX.Element {
    const [value, setValue] = React.useState('dark')

    return (
      <CoveSelect
        testId="theme-select"
        value={value}
        disabled={disabled}
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
        onChange={setValue}
      />
    )
  }

  return render(<Harness />)
}

describe('CoveSelect', () => {
  it('selects an option and updates the hidden value', () => {
    renderHarness()

    fireEvent.click(screen.getByTestId('theme-select-trigger'))
    fireEvent.click(screen.getByRole('option', { name: 'Light' }))

    expect(screen.getByTestId('theme-select')).toHaveValue('light')
    expect(screen.getByTestId('theme-select-trigger')).toHaveTextContent('Light')
  })

  it('updates the highlighted option on hover', () => {
    renderHarness()

    fireEvent.click(screen.getByTestId('theme-select-trigger'))

    const darkOption = screen.getByRole('option', { name: 'Dark' })
    const lightOption = screen.getByRole('option', { name: 'Light' })

    expect(darkOption).toHaveClass('cove-select__option--highlighted')
    fireEvent.mouseEnter(lightOption)
    expect(lightOption).toHaveClass('cove-select__option--highlighted')
    expect(darkOption).not.toHaveClass('cove-select__option--highlighted')
  })

  it('moves the highlighted option with keyboard navigation', () => {
    renderHarness()

    const trigger = screen.getByTestId('theme-select-trigger')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    expect(screen.getByRole('option', { name: 'Light' })).toHaveClass(
      'cove-select__option--highlighted',
    )
  })

  it('does not open when disabled', () => {
    renderHarness(true)

    fireEvent.click(screen.getByTestId('theme-select-trigger'))

    expect(screen.queryByRole('option', { name: 'Light' })).not.toBeInTheDocument()
  })

  it('raises a portaled menu above its containing dialog', () => {
    render(
      <Dialog open aria-label="Preferences" onDismiss={() => {}}>
        <CoveSelect
          testId="dialog-theme-select"
          value="dark"
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          onChange={() => {}}
        />
      </Dialog>,
    )

    fireEvent.click(screen.getByTestId('dialog-theme-select-trigger'))

    expect(screen.getByRole('listbox')).toHaveClass('cove-select__menu--within-dialog')
  })
})
