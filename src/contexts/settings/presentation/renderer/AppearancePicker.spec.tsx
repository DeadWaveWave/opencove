import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import { AppearancePicker } from './AppearancePicker'

describe('AppearancePicker', () => {
  beforeEach(async () => {
    await applyUiLanguage('en')
  })

  it('offers light, dark and system as one radio group, each the app in miniature', () => {
    const onValueChange = vi.fn()
    render(
      <AppearancePicker
        value="dark"
        label="Appearance"
        testIdPrefix="mode"
        onValueChange={onValueChange}
      />,
    )

    const group = screen.getByRole('radiogroup', { name: 'Appearance' })
    expect(group).toBe(screen.getByTestId('mode'))
    const radios = screen.getAllByRole('radio')
    expect(radios.map(radio => radio.getAttribute('value'))).toEqual(['light', 'dark', 'system'])
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(screen.getByTestId('mode-light')).not.toBeChecked()
    expect(new Set(radios.map(radio => radio.getAttribute('name'))).size).toBe(1)

    // Each thumbnail is pixel art: crisp edges at a whole pixel scale, hidden from the name.
    const thumbnails = group.querySelectorAll('svg.cove-appearance-picker__thumbnail')
    expect(thumbnails).toHaveLength(3)
    expect(thumbnails[0]).toHaveAttribute('shape-rendering', 'crispEdges')
    expect(thumbnails[0]).toHaveAttribute('width', '84')
    expect(thumbnails[0]!.closest('[aria-hidden="true"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: 'Follow System' }))
    expect(onValueChange).toHaveBeenCalledWith('system')
  })

  it('marks only the checked appearance, and draws larger on the settings page', () => {
    const { container } = render(
      <AppearancePicker
        value="light"
        label="Appearance"
        size="lg"
        testIdPrefix="mode"
        onValueChange={() => {}}
      />,
    )

    const options = container.querySelectorAll('.cove-appearance-picker__option')
    expect([...options].map(option => option.getAttribute('data-state'))).toEqual([
      'on',
      'off',
      'off',
    ])
    expect(container.querySelectorAll('.cove-appearance-picker__check')).toHaveLength(1)
    expect(container.querySelector('svg.cove-appearance-picker__thumbnail')).toHaveAttribute(
      'width',
      '126',
    )
  })

  it('checks nothing under a plugin theme; focus enters on the first appearance', () => {
    const entryRef = createRef<HTMLInputElement>()
    const onValueChange = vi.fn()
    render(
      <AppearancePicker
        value="plugin:example:theme"
        label="Appearance"
        testIdPrefix="mode"
        entryRef={entryRef}
        onValueChange={onValueChange}
      />,
    )

    expect(
      screen.getAllByRole('radio').filter(radio => (radio as HTMLInputElement).checked),
    ).toHaveLength(0)
    expect(entryRef.current).toBe(screen.getByTestId('mode-light'))

    // Picking one goes back to Cove in that appearance.
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(onValueChange).toHaveBeenCalledWith('dark')
  })

  it('enters focus on the checked appearance', () => {
    const entryRef = createRef<HTMLInputElement>()
    render(
      <AppearancePicker
        value="system"
        label="Appearance"
        testIdPrefix="mode"
        entryRef={entryRef}
        onValueChange={() => {}}
      />,
    )
    expect(entryRef.current).toBe(screen.getByTestId('mode-system'))
  })
})
