import React, { type ComponentProps } from 'react'
import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { CanvasFlowHost } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/CanvasFlowHost'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { renderWithCanvasStore } from '../../support/canvasStoreTestHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'

// The host hands the canvas view what it renders: the committed nodes with the live overlay applied
// and the frame preview of the Space drag or, without one, of the node drag. Both previews come
// from the `interaction` slice (#738, PR 6); the host takes no preview from its parent.

const seen = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}))

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/TerminalDisplayAlignedWorkspaceCanvasView',
  () => ({
    TerminalDisplayAlignedWorkspaceCanvasView: (props: Record<string, unknown>) => {
      seen.props.push(props)
      return null
    },
  }),
)

const rect = (x: number) => ({ x, y: 0, width: 100, height: 100 })

function mountHost({ committedNodes }: { committedNodes: Node<TerminalNodeData>[] }) {
  seen.props.length = 0
  const props = {
    workspaceId: 'workspace-1',
    marker: 'passed through',
    committedNodes,
  } as unknown as ComponentProps<typeof CanvasFlowHost>
  const view = renderWithCanvasStore(<CanvasFlowHost {...props} />)
  const last = () =>
    seen.props.at(-1) as {
      nodes: Node<TerminalNodeData>[]
      spaceFramePreview: ReadonlyMap<string, ReturnType<typeof rect>> | null
      workspaceId: string
      marker: string
    }
  return { view, last }
}

describe('CanvasFlowHost', () => {
  const committed = createRowNodes(['a', 'b'])

  it('renders the committed nodes themselves, and passes the other props on, when no gesture is live', () => {
    const { last } = mountHost({ committedNodes: committed })

    expect(last().nodes).toBe(committed)
    expect(last().spaceFramePreview).toBeNull()
    expect(last().workspaceId).toBe('workspace-1')
    expect(last().marker).toBe('passed through')
  })

  it('renders the live position with the committed data, and the committed nodes again after the gesture', () => {
    const { view, last } = mountHost({ committedNodes: committed })
    // The entry carries a position and a flag; the node's data is the committed node's.
    const live = new Map([['a', { position: { x: 5, y: 30 }, dragging: true }]])

    act(() => view.interaction.publishLiveNodes(live))
    expect(last().nodes[0].position).toEqual({ x: 5, y: 30 })
    expect(last().nodes[0].dragging).toBe(true)
    expect(last().nodes[0].data).toBe(committed[0].data)
    expect(last().nodes[1]).toBe(committed[1])

    act(() => view.interaction.endLiveNodes())
    expect(last().nodes).toBe(committed)
  })

  // Both previews are read from the slice. A host that read only the node drag's would show no
  // frame during a Space drag; one that read only the Space drag's, none during a node drag.
  it('renders the preview of the node drag when no Space drag is live', () => {
    const nodeDrag = new Map([['s', rect(1)]])
    const { view, last } = mountHost({ committedNodes: committed })

    act(() => view.interaction.setNodeDragFramePreview(nodeDrag))
    expect(last().spaceFramePreview).toBe(nodeDrag)

    act(() => view.interaction.setNodeDragFramePreview(null))
    expect(last().spaceFramePreview).toBeNull()
  })

  it('renders the preview of the Space drag from the slice', () => {
    const spaceDrag = new Map([['s', rect(2)]])
    const { view, last } = mountHost({ committedNodes: committed })

    act(() => view.interaction.setSpaceDragFramePreview(spaceDrag))
    expect(last().spaceFramePreview).toBe(spaceDrag)

    act(() => view.interaction.setSpaceDragFramePreview(null))
    expect(last().spaceFramePreview).toBeNull()
  })

  it('renders the preview of the Space drag over the one of the node drag, and the latter again after it', () => {
    const nodeDrag = new Map([['s', rect(1)]])
    const spaceDrag = new Map([['s', rect(2)]])
    const { view, last } = mountHost({ committedNodes: committed })

    act(() => view.interaction.setNodeDragFramePreview(nodeDrag))
    act(() => view.interaction.setSpaceDragFramePreview(spaceDrag))
    expect(last().spaceFramePreview).toBe(spaceDrag)

    act(() => view.interaction.setSpaceDragFramePreview(null))
    expect(last().spaceFramePreview).toBe(nodeDrag)
  })

  it('ignores a preview that its parent hands it as a prop', () => {
    seen.props.length = 0
    const stray = new Map([['s', rect(9)]])
    const props = {
      committedNodes: committed,
      spaceDragFramePreview: stray,
    } as unknown as ComponentProps<typeof CanvasFlowHost>

    renderWithCanvasStore(<CanvasFlowHost {...props} />)

    expect(seen.props.at(-1)?.spaceFramePreview).toBeNull()
  })

  it('does not render again for a Space drag preview equal to the one it shows', () => {
    const { view } = mountHost({ committedNodes: committed })
    act(() => view.interaction.setSpaceDragFramePreview(new Map([['s', rect(2)]])))
    const rendersBefore = seen.props.length

    act(() => view.interaction.setSpaceDragFramePreview(new Map([['s', rect(2)]])))

    expect(seen.props).toHaveLength(rendersBefore)
  })

  it('does not render for the guides, the marquee or the snapping toggle', () => {
    const { view } = mountHost({ committedNodes: committed })
    const rendersBefore = seen.props.length

    act(() => view.interaction.setSnapGuides([{ kind: 'v', x: 1, y1: 0, y2: 10 }]))
    act(() =>
      view.interaction.setSelectionDraft({
        startX: 0,
        startY: 0,
        currentX: 1,
        currentY: 1,
        phase: 'active',
      }),
    )
    act(() => view.interaction.toggleMagneticSnapping())

    expect(seen.props).toHaveLength(rendersBefore)
  })
})
