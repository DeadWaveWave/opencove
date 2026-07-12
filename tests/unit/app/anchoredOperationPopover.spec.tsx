import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnchoredOperationPopover } from '../../../src/app/renderer/components/AnchoredOperationPopover'
import { CoveSelect } from '../../../src/app/renderer/components/CoveSelect'

describe('AnchoredOperationPopover', () => {
  it('behaves like a transient menu-adjacent surface', () => {
    const onDismiss = vi.fn()

    render(
      <>
        <button type="button" data-testid="outside">
          Outside
        </button>
        <AnchoredOperationPopover
          anchor={{ x: 180, y: 96 }}
          ariaLabel="Create worktree"
          onDismiss={onDismiss}
          testId="operation-popover"
        >
          <input aria-label="Branch" />
        </AnchoredOperationPopover>
      </>,
    )

    const popover = screen.getByTestId('operation-popover')
    expect(popover).toHaveAttribute('role', 'dialog')
    expect(popover).toHaveAttribute('aria-modal', 'false')
    expect(popover).toHaveStyle({ left: '180px', top: '96px' })

    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('dismisses on Escape unless dismissal is disabled', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(
      <AnchoredOperationPopover
        anchor={{ x: 20, y: 30 }}
        ariaLabel="Operation"
        onDismiss={onDismiss}
        testId="operation-popover"
      >
        <button type="button">Confirm</button>
      </AnchoredOperationPopover>,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)

    rerender(
      <AnchoredOperationPopover
        anchor={{ x: 20, y: 30 }}
        ariaLabel="Operation"
        dismissDisabled
        onDismiss={onDismiss}
        testId="operation-popover"
      >
        <button type="button">Confirm</button>
      </AnchoredOperationPopover>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps the parent open while interacting with a portaled child menu', () => {
    const onDismiss = vi.fn()
    const onChange = vi.fn()

    render(
      <AnchoredOperationPopover
        anchor={{ x: 20, y: 30 }}
        ariaLabel="Operation"
        onDismiss={onDismiss}
        testId="operation-popover"
      >
        <CoveSelect
          testId="branch-select"
          value="main"
          options={[
            { value: 'main', label: 'main' },
            { value: 'feature/demo', label: 'feature/demo' },
          ]}
          onChange={onChange}
        />
      </AnchoredOperationPopover>,
    )

    fireEvent.click(screen.getByTestId('branch-select-trigger'))
    const option = screen.getByRole('option', { name: 'feature/demo' })
    expect(option.closest('[data-cove-transient-layer-owner]')).not.toBeNull()

    fireEvent.keyDown(option, { key: 'Escape' })
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('branch-select-trigger'))
    const reopenedOption = screen.getByRole('option', { name: 'feature/demo' })

    fireEvent.pointerDown(reopenedOption)
    fireEvent.click(reopenedOption)

    expect(onChange).toHaveBeenCalledWith('feature/demo')
    expect(onDismiss).not.toHaveBeenCalled()
    expect(screen.getByTestId('operation-popover')).toBeVisible()

    fireEvent.keyDown(screen.getByTestId('branch-select-trigger'), { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
