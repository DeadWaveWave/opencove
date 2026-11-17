import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  applyLiveNodes,
  decorateFlowNodes,
} from '../../../src/contexts/workspace/presentation/renderer/utils/canvasLiveNodes'
import { NODE_DRAG_HANDLE_SELECTOR } from '../../../src/contexts/workspace/presentation/renderer/utils/nodeFrameResize'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createRowNodes } from '../../support/canvasSelectionFixtures'

type FlowNode = Node<TerminalNodeData>

function moved(node: FlowNode, x: number, y: number, dragging = true): FlowNode {
  return { ...node, position: { x, y }, dragging }
}

function retitled(node: FlowNode, title: string): FlowNode {
  return { ...node, data: { ...node.data, title } }
}

// The rule of #738 PR 3, introduced unchanged: the table characterizes what React Flow shows
// today while a node gesture is live. PR 5 narrows it; the row about an external move changes then.
describe('applyLiveNodes', () => {
  const [a, b, c] = createRowNodes(['a', 'b', 'c'])

  it('returns the committed array itself when no gesture is live', () => {
    const committed = [a, b, c]

    expect(applyLiveNodes(committed, null)).toBe(committed)
  })

  it('shows the live position with the committed data when an overlay position differs', () => {
    const committed = [a, retitled(b, 'changed elsewhere'), c]
    const live = [a, moved(b, 410, 12), c]

    const shown = applyLiveNodes(committed, live)

    expect(shown).not.toBe(committed)
    expect(shown[1].position).toEqual({ x: 410, y: 12 })
    expect(shown[1].dragging).toBe(true)
    expect(shown[1].data.title).toBe('changed elsewhere')
    expect(shown[1].id).toBe('b')
  })

  it('keeps the committed object for a node whose position is equal', () => {
    const committed = [a, b, c]
    const live = [moved(a, 5, 5), { ...b }, c]

    const shown = applyLiveNodes(committed, live)

    expect(shown[0].position).toEqual({ x: 5, y: 5 })
    expect(shown[1]).toBe(b)
    expect(shown[2]).toBe(c)
  })

  it('returns the committed array itself when nothing differs', () => {
    const committed = [a, b, c]
    const live = [{ ...a }, { ...b, dragging: true }, { ...c }]

    expect(applyLiveNodes(committed, live)).toBe(committed)
  })

  it('takes membership and the other fields from the committed nodes, not from the live ones', () => {
    const committed = [a, b]
    const live = [
      {
        ...moved(a, 5, 5),
        selected: true,
        dragHandle: '.live',
        data: { ...a.data, title: 'live' },
      },
      b,
    ]

    const [shown] = applyLiveNodes(committed, live)

    expect(shown.position).toEqual({ x: 5, y: 5 })
    expect(shown.selected).toBe(a.selected)
    expect(shown.dragHandle).toBe(a.dragHandle)
    expect(shown.data).toBe(a.data)
  })

  it('shows a node that was added from elsewhere', () => {
    const committed = [a, b, c]
    const live = [moved(a, 5, 5), b]

    const shown = applyLiveNodes(committed, live)

    expect(shown.map(node => node.id)).toEqual(['a', 'b', 'c'])
    expect(shown[2]).toBe(c)
  })

  it('drops a node that was removed from elsewhere and ignores its entry', () => {
    const committed = [a, c]
    const live = [moved(a, 5, 5), moved(b, 999, 999), c]

    const shown = applyLiveNodes(committed, live)

    expect(shown.map(node => node.id)).toEqual(['a', 'c'])
    expect(applyLiveNodes([a, c], [moved(b, 999, 999), c])).toEqual([a, c])
    expect(applyLiveNodes([c], [a, moved(b, 999, 999), c])).toEqual([c])
  })

  // Today's rule, not a wish: the live array holds every node's position as of the last frame, so
  // the old position of a node the gesture did not move beats an external move of that node.
  it("masks an external move of a node the gesture did not move (today's rule)", () => {
    const live = [moved(a, 5, 5), b, c]
    const committed = [a, moved(b, 700, 300, false), c]

    const shown = applyLiveNodes(committed, live)

    expect(shown[1].position).toEqual(b.position)
    expect(shown[1].position).not.toEqual(committed[1].position)
  })
})

describe('decorateFlowNodes', () => {
  const nodes = createRowNodes(['a', 'b', 'c'])

  it('derives selected and dragHandle from the selection', () => {
    const decorated = decorateFlowNodes(nodes, new Set(['b']), false)

    expect(decorated.map(node => node.selected)).toEqual([false, true, false])
    expect(decorated.map(node => node.dragHandle)).toEqual(Array(3).fill(NODE_DRAG_HANDLE_SELECTOR))
  })

  it('drops the drag handle of a selected node on the drag surface', () => {
    const decorated = decorateFlowNodes(nodes, new Set(['b']), true)

    expect(decorated.map(node => node.dragHandle)).toEqual([
      NODE_DRAG_HANDLE_SELECTOR,
      undefined,
      NODE_DRAG_HANDLE_SELECTOR,
    ])
  })

  it('keeps the identity of the nodes that did not change', () => {
    const first = decorateFlowNodes(nodes, new Set(['b']), false)
    const second = decorateFlowNodes(first, new Set(['b', 'c']), false)

    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[2]).not.toBe(first[2])
    expect(second[2].selected).toBe(true)
  })
})
