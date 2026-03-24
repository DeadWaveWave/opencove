import React, { useMemo, useRef, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NodeFrame } from '../../../src/contexts/workspace/presentation/renderer/types'
import { useNodeFrameResize } from '../../../src/contexts/workspace/presentation/renderer/utils/nodeFrameResize'

vi.mock('@xyflow/react', () => {
  return {
    useStore: (selector: (state: unknown) => unknown) => selector({ transform: [0, 0, 1] }),
  }
})

function ensurePointerCaptureSupport(): void {
  if (!('setPointerCapture' in HTMLElement.prototype)) {
    // @ts-expect-error - happy-dom does not implement this API.
    HTMLElement.prototype.setPointerCapture = () => undefined
  }
}

function buildNodeStyle({
  base,
  rendered,
}: {
  base: NodeFrame
  rendered: NodeFrame
}): React.CSSProperties {
  return {
    width: rendered.size.width,
    height: rendered.size.height,
    transform:
      rendered.position.x !== base.position.x || rendered.position.y !== base.position.y
        ? `translate(${rendered.position.x - base.position.x}px, ${rendered.position.y - base.position.y}px)`
        : undefined,
  }
}

function ResizeHarness(): React.JSX.Element {
  const [frame, setFrame] = useState<NodeFrame>({
    position: { x: 0, y: 0 },
    size: { width: 200, height: 120 },
  })
  const frameRef = useRef<NodeFrame>(frame)

  const commitFrame = (next: NodeFrame) => {
    frameRef.current = next
    setFrame(next)
  }

  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position: frame.position,
    width: frame.size.width,
    height: frame.size.height,
    minSize: { width: 160, height: 100 },
    onResize: nextFrame => {
      commitFrame(nextFrame)
    },
  })

  const renderedFrame = draftFrame ?? frame
  const nodeStyle = useMemo(
    () => buildNodeStyle({ base: frame, rendered: renderedFrame }),
    [frame, renderedFrame],
  )

  return (
    <div>
      <div data-testid="node" style={nodeStyle}>
        <div
          data-testid="handle"
          onPointerDown={handleResizePointerDown({ right: true, bottom: true })}
        />
      </div>
      <button
        type="button"
        data-testid="arrange"
        onClick={() => {
          const current = frameRef.current
          commitFrame({
            position: { x: 400, y: 240 },
            size: current.size,
          })
        }}
      >
        Arrange
      </button>
    </div>
  )
}

describe('useNodeFrameResize', () => {
  it('does not leave a stale draft transform when an external layout (Arrange) overrides the resize commit', async () => {
    ensurePointerCaptureSupport()

    render(<ResizeHarness />)

    const node = screen.getByTestId('node') as HTMLElement
    const handle = screen.getByTestId('handle')
    const arrange = screen.getByTestId('arrange')

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 })

    window.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: 64,
        clientY: 0,
      }),
    )

    // End resize and immediately apply an external layout update (Arrange) before the resize commit
    // lands in the rendered base frame.
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 64, clientY: 0 }))
    fireEvent.click(arrange)

    await waitFor(() => {
      expect(node.style.transform).toBe('')
    })
  })
})
