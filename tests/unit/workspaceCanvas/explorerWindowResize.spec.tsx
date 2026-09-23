import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NodeFrame } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  resolveExplorerResizedFrame,
  resolveExplorerWindowPlacement,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlay.layout'
import { useExplorerWindowResize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/useExplorerWindowResize'

const spaceRect = { x: 100, y: 200, width: 900, height: 520 }
const placement = resolveExplorerWindowPlacement({
  spaceRect,
  preferredWidth: 320,
  preferredHeight: 468,
  preferredOffset: { x: 80, y: 36 },
})

function ResizeHarness({
  onResize,
  zoom = 0.5,
}: {
  onResize: (frame: NodeFrame) => void
  zoom?: number
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const handleResizePointerDown = useExplorerWindowResize({
    placement,
    zoom,
    containerRef,
    onResize,
  })
  return (
    <div ref={containerRef} tabIndex={0}>
      <button type="button" onPointerDown={handleResizePointerDown({ left: true, top: true })}>
        Resize
      </button>
    </div>
  )
}

describe('explorer window resize', () => {
  it('retains the opposite edge after top expansion is reconciled with the Space bounds', () => {
    const frame = resolveExplorerResizedFrame(
      placement,
      { top: true, left: true },
      { x: -100, y: -100 },
    )
    const settled = resolveExplorerWindowPlacement({
      spaceRect,
      preferredWidth: frame.size.width,
      preferredHeight: frame.size.height,
      preferredOffset: frame.position,
    })
    expect(settled.offset).toEqual({ x: 16, y: 16 })
    expect(settled.width).toBe(frame.size.width)
    expect(settled.height).toBe(488)
    expect(settled.top + settled.height).toBe(placement.top + placement.height)
    expect(settled.left + settled.width).toBe(placement.left + placement.width)
  })

  it('converts screen motion to canvas dimensions and ignores unrelated pointers', () => {
    const onResize = vi.fn()
    render(<ResizeHarness onResize={onResize} />)
    fireEvent.pointerDown(screen.getByRole('button'), {
      button: 0,
      pointerId: 7,
      clientX: 200,
      clientY: 200,
    })
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 220, clientY: 230 })
    expect(onResize).not.toHaveBeenCalled()
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 220, clientY: 230 })
    expect(onResize).toHaveBeenCalledExactlyOnceWith({
      position: { x: 120, y: 96 },
      size: { width: 280, height: 408 },
    })
    fireEvent.pointerUp(window, { pointerId: 7 })
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 240, clientY: 250 })
    expect(onResize).toHaveBeenCalledOnce()
  })

  it.each(['blur', 'unmount'] as const)('stops an in-progress resize on %s', end => {
    const onResize = vi.fn()
    const view = render(<ResizeHarness onResize={onResize} />)
    fireEvent.pointerDown(screen.getByRole('button'), {
      button: 0,
      pointerId: 7,
      clientX: 200,
      clientY: 200,
    })
    if (end === 'blur') {
      fireEvent(window, new Event('blur'))
    } else {
      view.unmount()
    }
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 220, clientY: 230 })
    expect(onResize).not.toHaveBeenCalled()
  })
})
