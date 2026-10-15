import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('is a native checkbox named by its label that reports the requested state', () => {
    const onCheckedChange = vi.fn()
    const { rerender } = render(
      <Checkbox checked={false} onCheckedChange={onCheckedChange} data-testid="delete-worktree">
        Delete the worktree
      </Checkbox>,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Delete the worktree' })
    expect(checkbox).toBe(screen.getByTestId('delete-worktree'))
    expect(checkbox).not.toBeChecked()
    fireEvent.click(screen.getByText('Delete the worktree'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    rerender(
      <Checkbox checked onCheckedChange={onCheckedChange} data-testid="delete-worktree">
        Delete the worktree
      </Checkbox>,
    )
    expect(checkbox).toBeChecked()
  })

  it('describes itself with its supporting text and keeps disabled semantics', () => {
    const onCheckedChange = vi.fn()
    render(
      <Checkbox
        checked={false}
        disabled
        description="The branch stays in the repository."
        onCheckedChange={onCheckedChange}
      >
        Delete the worktree
      </Checkbox>,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Delete the worktree' })
    expect(checkbox).toHaveAccessibleDescription('The branch stays in the repository.')
    expect(checkbox).toBeDisabled()
    fireEvent.click(checkbox)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
