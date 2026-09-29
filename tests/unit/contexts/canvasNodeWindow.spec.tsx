import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasNodeWindow } from '../../../src/contexts/workspace/presentation/renderer/components/shared/CanvasNodeWindow'
import { WindowCollapseContext } from '../../../src/contexts/workspace/presentation/renderer/components/shared/WindowCollapseButton'

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ transform: [0, 0, 0.5] }),
}))

const base = {
  id: 'plugin-one',
  title: 'Git Board',
  position: { x: 100, y: 200 },
  width: 600,
  height: 500,
  onClose: () => undefined,
  onResize: () => undefined,
}

describe('CanvasNodeWindow host contract', () => {
  beforeEach(() => {
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = () => undefined
    }
  })

  it.each([
    ['left', -20, 0, { x: 60, y: 200 }, { width: 640, height: 500 }],
    ['right', 20, 0, { x: 100, y: 200 }, { width: 640, height: 500 }],
    ['top', 0, -20, { x: 100, y: 160 }, { width: 600, height: 540 }],
    ['bottom', 0, 20, { x: 100, y: 200 }, { width: 600, height: 540 }],
    ['top-left', -20, -20, { x: 60, y: 160 }, { width: 640, height: 540 }],
    ['top-right', 20, -20, { x: 100, y: 160 }, { width: 640, height: 540 }],
    ['bottom-left', -20, 20, { x: 60, y: 200 }, { width: 640, height: 540 }],
    ['bottom-right', 20, 20, { x: 100, y: 200 }, { width: 640, height: 540 }],
  ] as const)(
    'previews and commits %s resize in canvas coordinates',
    (edge, x, y, position, size) => {
      const onResize = vi.fn()
      const view = render(
        <CanvasNodeWindow {...base} onResize={onResize}>
          Content
        </CanvasNodeWindow>,
      )
      const shell = screen.getByTestId('canvas-window-node-plugin-one')
      const handle = screen.getByTestId(`canvas-window-resizer-${edge}`)

      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(window, { clientX: x, clientY: y })
      expect(shell).toHaveStyle({ width: `${size.width}px`, height: `${size.height}px` })
      const dx = position.x - base.position.x
      const dy = position.y - base.position.y
      expect(shell.style.transform).toBe(dx || dy ? `translate(${dx}px, ${dy}px)` : '')
      expect(onResize).not.toHaveBeenCalled()

      fireEvent.pointerUp(window, { clientX: x, clientY: y })
      expect(onResize).toHaveBeenCalledExactlyOnceWith({ position, size })
      view.rerender(
        <CanvasNodeWindow {...base} position={position} {...size} onResize={onResize}>
          Content
        </CanvasNodeWindow>,
      )
      expect(shell.style.transform).toBe('')
    },
  )

  it('removes a pending resize listener when the shell is unmounted', () => {
    const onResize = vi.fn()
    const { unmount } = render(
      <CanvasNodeWindow {...base} onResize={onResize}>
        Content
      </CanvasNodeWindow>,
    )
    fireEvent.pointerDown(screen.getByTestId('canvas-window-resizer-left'), {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    })
    unmount()
    fireEvent.pointerMove(window, { clientX: -20, clientY: 0 })
    fireEvent.pointerUp(window, { clientX: -20, clientY: 0 })
    expect(onResize).not.toHaveBeenCalled()
  })

  it('registers the real close owner and keeps controls out of the drag selection gesture', () => {
    const onClose = vi.fn()
    const onInteractionStart = vi.fn()
    const toggle = vi.fn()
    const unregister = vi.fn()
    const registerCloseHandler = vi.fn(() => unregister)
    const collapseControls = Object.freeze({
      nodeId: base.id,
      collapsed: false,
      hidden: false,
      toggle,
      registerCloseHandler,
    })
    const { container, unmount } = render(
      <WindowCollapseContext.Provider value={collapseControls}>
        <CanvasNodeWindow {...base} onClose={onClose} onInteractionStart={onInteractionStart}>
          Content
        </CanvasNodeWindow>
      </WindowCollapseContext.Provider>,
    )
    expect(registerCloseHandler).toHaveBeenCalledWith(expect.any(Function))
    expect(container.querySelector('.cove-node-kind-icon')).toHaveAttribute('width', '16')
    const header = container.querySelector('[data-node-drag-handle="true"]')!
    fireEvent.pointerDown(header, { button: 0, shiftKey: true })
    expect(onInteractionStart).toHaveBeenCalledExactlyOnceWith({ shiftKey: true })
    fireEvent.pointerDown(screen.getByTestId('node-collapse'), { button: 0 })
    fireEvent.click(screen.getByTestId('node-collapse'))
    expect(toggle).toHaveBeenCalledOnce()
    fireEvent.pointerDown(screen.getByTestId('canvas-window-close'), { button: 0 })
    fireEvent.click(screen.getByTestId('canvas-window-close'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onInteractionStart).toHaveBeenCalledOnce()
    unmount()
    expect(unregister).toHaveBeenCalledOnce()
  })
})
