import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KindTile } from './KindTile'
import { StatusPill } from './StatusPill'

describe('StatusPill', () => {
  it('always shows its text and carries the tone as data, with dots only while working', () => {
    const { rerender } = render(<StatusPill tone="working">Working</StatusPill>)
    const pill = screen.getByText('Working')
    expect(pill).toHaveAttribute('data-tone', 'working')
    expect(pill.querySelectorAll('.cove-status-pill__dots > i')).toHaveLength(3)
    expect(pill.querySelector('.cove-status-pill__dots')).toHaveAttribute('aria-hidden', 'true')

    rerender(<StatusPill tone="waiting">Needs you</StatusPill>)
    expect(screen.getByText('Needs you')).toHaveAttribute('data-tone', 'waiting')
    expect(screen.getByText('Needs you').querySelector('.cove-status-pill__dots')).toBeNull()
  })

  it('keeps the caller’s class for existing hooks', () => {
    render(
      <StatusPill tone="failed" className="terminal-node__status">
        Failed
      </StatusPill>,
    )
    expect(screen.getByText('Failed')).toHaveClass('cove-status-pill', 'terminal-node__status')
  })
})

describe('KindTile', () => {
  it('renders a decorative tile for the kind family and size', () => {
    const { container } = render(
      <KindTile kind="shell" size="sm">
        <svg />
      </KindTile>,
    )
    const tile = container.querySelector('.cove-kind-tile')
    expect(tile).toHaveAttribute('data-kind', 'shell')
    expect(tile).toHaveAttribute('data-size', 'sm')
    expect(tile).toHaveAttribute('aria-hidden', 'true')
  })
})
