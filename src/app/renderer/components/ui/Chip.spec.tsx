import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Chip } from './Chip'

describe('Chip', () => {
  it('is a toggle button when it can be selected', () => {
    const onSelectedChange = vi.fn()
    const { rerender } = render(
      <Chip selected={false} onSelectedChange={onSelectedChange}>
        bug
      </Chip>,
    )

    const chip = screen.getByRole('button', { name: 'bug', pressed: false })
    expect(chip.getAttribute('type')).toBe('button')
    fireEvent.click(chip)
    expect(onSelectedChange).toHaveBeenCalledWith(true)

    rerender(
      <Chip selected onSelectedChange={onSelectedChange}>
        bug
      </Chip>,
    )
    expect(screen.getByRole('button', { name: 'bug', pressed: true })).toBe(chip)
    fireEvent.click(chip)
    expect(onSelectedChange).toHaveBeenLastCalledWith(false)
  })

  it('is a plain button without selection and keeps disabled semantics', () => {
    const onClick = vi.fn()
    render(
      <Chip onClick={onClick} disabled>
        docs
      </Chip>,
    )

    const chip = screen.getByRole('button', { name: 'docs' })
    expect(chip.hasAttribute('aria-pressed')).toBe(false)
    expect(chip).toBeDisabled()
    fireEvent.click(chip)
    expect(onClick).not.toHaveBeenCalled()
  })
})
