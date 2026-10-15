import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WindowHeader } from './WindowHeader'
import { WindowCollapseContext, type WindowCollapseControls } from './WindowCollapseButton'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function collapseControls(): WindowCollapseControls {
  return {
    nodeId: 'note-1',
    collapsed: false,
    hidden: false,
    toggle: () => {},
    registerCloseHandler: () => () => {},
  }
}

describe('WindowHeader', () => {
  it('lays out label, kind tile, title, drag space, actions, collapse and close in order', () => {
    const onClose = vi.fn()
    const controls = collapseControls()
    const { container } = render(
      <WindowCollapseContext.Provider value={controls}>
        <WindowHeader
          className="note-node__header"
          labelColor="red"
          icon={<svg data-testid="kind-icon" />}
          title={<span data-testid="title">Notes</span>}
          dragSurfaceTestId="note-node-header-drag-surface"
          actions={<button type="button">More</button>}
          close={{ label: 'Delete note', className: 'note-node__close', onClose }}
        />
      </WindowCollapseContext.Provider>,
    )

    const header = container.firstElementChild as HTMLElement
    expect(header.tagName).toBe('HEADER')
    expect(header).toHaveClass('cove-window-header', 'note-node__header')
    expect(header).toHaveAttribute('data-cove-part', 'window-header')
    expect(header).toHaveAttribute('data-node-drag-handle', 'true')

    const parts = [
      ...header.querySelectorAll<HTMLElement>(
        ':scope > *, :scope > .cove-window-header__trailing > *',
      ),
    ]
      .filter(element => !element.classList.contains('cove-window-header__trailing'))
      .map(element =>
        element.dataset.covePart === 'kind-tile'
          ? 'tile'
          : element.classList.contains('cove-label-dot')
            ? 'label'
            : element.dataset.testid === 'title'
              ? 'title'
              : element.dataset.testid === 'note-node-header-drag-surface'
                ? 'drag'
                : element.dataset.testid === 'node-collapse'
                  ? 'collapse'
                  : (element.getAttribute('aria-label') ?? element.textContent),
      )
    expect(parts).toEqual(['label', 'tile', 'title', 'drag', 'More', 'collapse', 'Delete note'])

    const tile = header.querySelector('[data-cove-part="kind-tile"]')
    expect(tile).toHaveAttribute('data-kind', 'neutral')
    expect(tile).toContainElement(screen.getByTestId('kind-icon'))
    expect(screen.getByTestId('note-node-header-drag-surface')).toHaveAttribute(
      'aria-hidden',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('places a status after the title and marks the trailing controls as not draggable', () => {
    const { container } = render(
      <WindowHeader
        className="terminal-node__header"
        icon={<svg />}
        title={<span>zsh</span>}
        status={<span data-testid="status">Working</span>}
        trailingClassName="terminal-node__header-trailing"
        close={{ label: 'Close window', onClose: () => {} }}
      />,
    )

    const header = container.firstElementChild as HTMLElement
    const status = screen.getByTestId('status').parentElement as HTMLElement
    expect(status).toHaveClass('cove-window-header__status')
    expect(status.previousElementSibling).toHaveTextContent('zsh')
    const trailing = header.querySelector('.cove-window-header__trailing')
    expect(trailing).toHaveClass('nodrag', 'terminal-node__header-trailing')
    expect(screen.queryByTestId('node-collapse')).toBeNull()
    expect(screen.getByRole('button', { name: 'Close window' }).parentElement).toBe(trailing)
  })
})
