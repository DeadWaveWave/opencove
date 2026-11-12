import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToggleTile } from './ToggleTile'
import { MapIcon } from './pixelIcons'

describe('ToggleTile', () => {
  it('is a native toggle button named by its label, pressed while on', () => {
    const onPressedChange = vi.fn()
    const { rerender } = render(
      <ToggleTile
        label="Minimap"
        icon={<MapIcon />}
        pressed={false}
        onPressedChange={onPressedChange}
        testId="tile"
      />,
    )

    const tile = screen.getByRole('button', { name: 'Minimap' })
    expect(tile).toHaveAttribute('type', 'button')
    expect(tile).toHaveAttribute('aria-pressed', 'false')
    expect(tile).toHaveAttribute('data-state', 'off')
    expect(tile).toBe(screen.getByTestId('tile'))

    fireEvent.click(tile)
    expect(onPressedChange).toHaveBeenCalledWith(true)

    rerender(
      <ToggleTile label="Minimap" icon={<MapIcon />} pressed onPressedChange={onPressedChange} />,
    )
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(tile).toHaveAttribute('data-state', 'on')
    fireEvent.click(tile)
    expect(onPressedChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps the icon and the light decorative, and the label fixed whatever the state', () => {
    const { container, rerender } = render(
      <ToggleTile label="Minimap" icon={<MapIcon />} pressed={false} onPressedChange={() => {}} />,
    )
    const face = container.querySelector('.cove-toggle-tile__face')!
    expect(face).toHaveAttribute('aria-hidden', 'true')
    expect(face.querySelector('svg')).not.toBeNull()
    expect(face.querySelector('.cove-toggle-tile__light')).not.toBeNull()
    expect(container.querySelector('.cove-toggle-tile__label')).toHaveTextContent('Minimap')

    rerender(<ToggleTile label="Minimap" icon={<MapIcon />} pressed onPressedChange={() => {}} />)
    expect(container.querySelector('.cove-toggle-tile__label')).toHaveTextContent('Minimap')
  })

  it('cannot be switched while disabled, and says why when told', () => {
    const onPressedChange = vi.fn()
    render(
      <ToggleTile
        label="Minimap"
        icon={<MapIcon />}
        pressed={false}
        disabled
        description="Open a project first"
        onPressedChange={onPressedChange}
      />,
    )
    const tile = screen.getByRole('button', { name: 'Minimap' })
    expect(tile).toBeDisabled()
    expect(tile).toHaveAccessibleDescription('Open a project first')
    fireEvent.click(tile)
    expect(onPressedChange).not.toHaveBeenCalled()
  })
})
