import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Surface, surfaceProps } from './Surface'

describe('Surface', () => {
  it('renders one of the three materials and keeps its own attributes', () => {
    render(
      <Surface
        material="acrylic"
        className="menu"
        data-testid="surface"
        role="menu"
        aria-label="Canvas"
      >
        Items
      </Surface>,
    )
    const surface = screen.getByTestId('surface')
    expect(surface).toHaveClass('cove-surface', 'menu')
    expect(surface).toHaveAttribute('data-material', 'acrylic')
    expect(surface).toHaveAttribute('data-cove-part', 'surface')
    expect(screen.getByRole('menu', { name: 'Canvas' })).toBe(surface)
  })

  it('gives elements that own their markup the same material attributes', () => {
    expect(surfaceProps('glass', 'cove-popover')).toEqual({
      className: 'cove-surface cove-popover',
      'data-material': 'glass',
    })
  })
})
