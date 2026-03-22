import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CoveSelect } from '../../../src/app/renderer/components/CoveSelect'

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

  it('does not open when disabled', () => {
    renderHarness(true)

    fireEvent.click(screen.getByTestId('theme-select-trigger'))

    expect(screen.queryByRole('option', { name: 'Light' })).not.toBeInTheDocument()
  })
})
