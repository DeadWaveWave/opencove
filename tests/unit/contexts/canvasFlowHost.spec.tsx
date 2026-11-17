import React, { type ComponentProps } from 'react'
import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { CanvasFlowHost } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/CanvasFlowHost'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { renderWithCanvasStore } from '../../support/canvasStoreTestHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'

// The host hands the canvas view what it renders: the committed nodes with the live overlay applied
// and the frame preview of the Space drag or, without one, of the node drag.

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

function mountHost({
  committedNodes,
  spaceDragFramePreview = null,
}: {
  committedNodes: Node<TerminalNodeData>[]
  spaceDragFramePreview?: ReadonlyMap<string, ReturnType<typeof rect>> | null
}) {
  seen.props.length = 0
  const props = {
    workspaceId: 'workspace-1',
    marker: 'passed through',
    committedNodes,
    spaceDragFramePreview,
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
    const live = [
      {
        ...committed[0],
        position: { x: 5, y: 30 },
        data: { ...committed[0].data, title: 'stale' },
      },
      committed[1],
    ]

    act(() => view.interaction.publishLiveNodes(live))
    expect(last().nodes[0].position).toEqual({ x: 5, y: 30 })
    expect(last().nodes[0].data).toBe(committed[0].data)
    expect(last().nodes[1]).toBe(committed[1])

    act(() => view.interaction.endLiveNodes())
    expect(last().nodes).toBe(committed)
  })

  it('renders the preview of the node drag, and the preview of the Space drag over it', () => {
    const nodeDrag = new Map([['s', rect(1)]])
    const spaceDrag = new Map([['s', rect(2)]])
    const mounted = mountHost({ committedNodes: committed })

    act(() => mounted.view.interaction.setNodeDragFramePreview(nodeDrag))
    expect(mounted.last().spaceFramePreview).toBe(nodeDrag)

    act(() => mounted.view.interaction.setNodeDragFramePreview(null))
    expect(mounted.last().spaceFramePreview).toBeNull()
    mounted.view.unmount()

    const both = mountHost({ committedNodes: committed, spaceDragFramePreview: spaceDrag })
    act(() => both.view.interaction.setNodeDragFramePreview(nodeDrag))
    expect(both.last().spaceFramePreview).toBe(spaceDrag)
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
