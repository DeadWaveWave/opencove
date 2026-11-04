import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CoveSelect } from './CoveSelect'
import { SettingRow } from './ui/SettingRow'

describe('CoveSelect', () => {
  it('takes its name from a setting row and still says the current value', () => {
    render(
      <SettingRow
        label="Language"
        description="Display language of the app."
        control={
          <CoveSelect
            ariaLabel="Language"
            value="en"
            options={[
              { value: 'en', label: 'English' },
              { value: 'zh-CN', label: '简体中文' },
            ]}
            onChange={vi.fn()}
          />
        }
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Language English' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(
      document.getElementById(trigger.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Display language of the app.')
  })

  it('keeps its own label when used alone', () => {
    render(
      <CoveSelect
        ariaLabel="Engine"
        value="a"
        options={[{ value: 'a', label: 'Alpha' }]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Engine' })).not.toBeNull()
  })
})
