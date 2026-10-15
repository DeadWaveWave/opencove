import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WindowCloseButton } from './WindowCloseButton'
import {
  WindowCollapseButton,
  WindowCollapseContext,
  type WindowCollapseControls,
} from './WindowCollapseButton'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function collapseControls(toggle: () => void): WindowCollapseControls {
  return {
    nodeId: 'note-1',
    collapsed: false,
    hidden: false,
    toggle,
    registerCloseHandler: () => () => {},
  }
}

describe('window controls', () => {
  it('closes through a named 24px icon button without starting a canvas gesture', () => {
    const onClose = vi.fn()
    const parentPointerDown = vi.fn()
    const parentClick = vi.fn()
    render(
      <div onPointerDown={parentPointerDown} onClick={parentClick}>
        <WindowCloseButton
          label="Delete note"
          className="note-node__close"
          data-testid="note-close"
          onClose={onClose}
        />
      </div>,
    )

    const close = screen.getByRole('button', { name: 'Delete note' })
    expect(close).toBe(screen.getByTestId('note-close'))
    expect(close).toHaveClass(
      'cove-icon-button',
      'cove-icon-button--xs',
      'note-node__close',
      'nodrag',
    )
    expect(close).not.toHaveAttribute('title')
    fireEvent.pointerDown(close)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
    expect(parentPointerDown).not.toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('collapses through the same icon button style and reports its state', () => {
    const toggle = vi.fn()
    const controls = collapseControls(toggle)
    render(
      <WindowCollapseContext.Provider value={controls}>
        <WindowCollapseButton onClose={() => {}} />
      </WindowCollapseContext.Provider>,
    )

    const collapse = screen.getByTestId('node-collapse')
    expect(collapse).toHaveAccessibleName('canvasCollapse.collapseWindow')
    expect(collapse).toHaveClass(
      'cove-icon-button',
      'cove-icon-button--xs',
      'cove-node-collapse-button',
    )
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse).toHaveAttribute('aria-controls', 'cove-node-runtime-note-1')
    expect(collapse).not.toHaveAttribute('title')
    fireEvent.click(collapse)
    expect(toggle).toHaveBeenCalledOnce()
  })
})
