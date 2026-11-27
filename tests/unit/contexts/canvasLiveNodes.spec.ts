import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  applyLiveNodes,
  applyReleasedPositions,
  areLiveNodesEqual,
  decorateFlowNodes,
  toLiveNodes,
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

const BASELINE = new Map([
  ['a', { x: 0, y: 0 }],
  ['b', { x: 400, y: 0 }],
  ['c', { x: 800, y: 0 }],
])

// The overlay of a node gesture holds the windows the gesture owns and nothing else (#738, PR 5).
// `toLiveNodes` picks them from a frame's array; `applyLiveNodes` shows them over the committed
// nodes, and the release applies the same entries to the store's nodes.
describe('toLiveNodes', () => {
  const [a, b, c] = createRowNodes(['a', 'b', 'c'])

  it('leaves out the nodes the gesture did not move', () => {
    const overlay = toLiveNodes([a, b, c], BASELINE)

    expect(overlay.size).toBe(0)
  })

  it('holds the window the gesture moved, at its position, with its flag', () => {
    const overlay = toLiveNodes([moved(a, 5, 30), b, c], BASELINE)

    expect([...overlay.keys()]).toEqual(['a'])
    expect(overlay.get('a')).toEqual({ position: { x: 5, y: 30 }, dragging: true })
  })

  it('holds a window the gesture pushed, which the frame moved without dragging it', () => {
    const overlay = toLiveNodes([moved(a, 5, 30), moved(b, 410, 12, false), c], BASELINE)

    expect([...overlay.keys()]).toEqual(['a', 'b'])
    expect(overlay.get('b')).toEqual({ position: { x: 410, y: 12 }, dragging: false })
  })

  it('holds a window marked as dragging even where it stands at its baseline', () => {
    const overlay = toLiveNodes([moved(a, 0, 0, true), b, c], BASELINE)

    expect(overlay.get('a')).toEqual({ position: { x: 0, y: 0 }, dragging: true })
  })

  it('leaves out a window at its baseline whose flag is not dragging', () => {
    expect(toLiveNodes([moved(a, 0, 0, false), b, c], BASELINE).size).toBe(0)
  })

  it('keeps no flag the node does not carry', () => {
    const overlay = toLiveNodes([{ ...a, position: { x: 1, y: 1 } }, b, c], BASELINE)

    expect(overlay.get('a')).toEqual({ position: { x: 1, y: 1 } })
    expect('dragging' in overlay.get('a')!).toBe(false)
  })

  // The frame's array holds a window that an external write moved at its baseline: the gesture's
  // projection resets every baselined window it does not move. Compared with the baseline it is
  // not the gesture's; compared with the committed position it would be.
  it('compares with the baseline, not with where the committed nodes stand', () => {
    const committedAfterExternalMove = moved(b, 700, 300, false)
    const frameArray = [moved(a, 5, 30), b, c]

    expect(toLiveNodes(frameArray, BASELINE).has('b')).toBe(false)
    expect(committedAfterExternalMove.position).not.toEqual(b.position)
  })

  // A frame that skips the projection of the other windows leaves a window that a write from
  // elsewhere moved where the store has it now: away from its baseline, but not the gesture's.
  it('leaves out a window that stands where the store holds it, however far from its baseline', () => {
    const committed = [a, moved(b, 700, 300, false), c]
    const frameArray = [moved(a, 5, 30), moved(b, 700, 300, false), c]

    expect([...toLiveNodes(frameArray, BASELINE, committed).keys()]).toEqual(['a'])
    // Without the store's nodes the baseline alone decides.
    expect([...toLiveNodes(frameArray, BASELINE).keys()]).toEqual(['a', 'b'])
  })

  it('holds a window that differs from both its baseline and the store', () => {
    const committed = [a, b, c]
    const frameArray = [a, moved(b, 410, 12, false), c]

    expect([...toLiveNodes(frameArray, BASELINE, committed).keys()]).toEqual(['b'])
  })

  it('holds a dragged window where the store holds it', () => {
    const committed = [a, b, c]

    expect(toLiveNodes([moved(a, 0, 0, true), b, c], BASELINE, committed).has('a')).toBe(true)
  })

  // Flipped by the review of PR 5. A window the baseline never held (created during the gesture)
  // has the store's position as its base in a frame, because the overlay holds no entry for it, so
  // a different position in the frame is the projection's push. It used to be left out, and the
  // release then left it under the dropped window.
  it('compares a window the baseline never held with the store only', () => {
    const created = { ...createRowNodes(['d'])[0], position: { x: 3000, y: 0 } }
    const committed = [a, created]

    expect(toLiveNodes([a, created], BASELINE, committed).has('d')).toBe(false)
    expect(toLiveNodes([a, moved(created, 3200, 0, false)], BASELINE, committed).has('d')).toBe(
      true,
    )
    expect(toLiveNodes([a, { ...created, dragging: true }], BASELINE, committed).has('d')).toBe(
      true,
    )
  })

  it('compares every window with the store only when there is no baseline', () => {
    const committed = [a, b, c]
    const overlay = toLiveNodes([moved(a, 5, 30), moved(b, 410, 12, false), c], null, committed)

    expect([...overlay.keys()]).toEqual(['a', 'b'])
    expect(toLiveNodes([a, b, c], null, committed).size).toBe(0)
  })

  it('returns nothing for an empty array', () => {
    expect(toLiveNodes([], BASELINE).size).toBe(0)
  })
})

describe('areLiveNodesEqual', () => {
  const entry = { position: { x: 1, y: 2 }, dragging: true }

  it('is true for the same map and for another map with the same entries', () => {
    const left = new Map([['a', entry]])

    expect(areLiveNodesEqual(left, left)).toBe(true)
    expect(areLiveNodesEqual(left, new Map([['a', { ...entry, position: { x: 1, y: 2 } }]]))).toBe(
      true,
    )
    expect(areLiveNodesEqual(null, null)).toBe(true)
  })

  it('reads an absent flag as not dragging', () => {
    expect(
      areLiveNodesEqual(
        new Map([['a', { position: { x: 1, y: 2 } }]]),
        new Map([['a', { position: { x: 1, y: 2 }, dragging: false }]]),
      ),
    ).toBe(true)
  })

  it('is false when a member, a position or a flag differs, and for null against a map', () => {
    const left = new Map([['a', entry]])

    expect(areLiveNodesEqual(left, new Map([['b', entry]]))).toBe(false)
    expect(areLiveNodesEqual(left, new Map([['a', { ...entry, position: { x: 1, y: 3 } }]]))).toBe(
      false,
    )
    expect(areLiveNodesEqual(left, new Map([['a', { ...entry, dragging: false }]]))).toBe(false)
    expect(areLiveNodesEqual(left, new Map([...left, ['b', entry]]))).toBe(false)
    expect(areLiveNodesEqual(left, null)).toBe(false)
    expect(areLiveNodesEqual(null, left)).toBe(false)
  })
})

describe('applyLiveNodes', () => {
  const [a, b, c] = createRowNodes(['a', 'b', 'c'])

  it('returns the committed array itself when no gesture is live, or the overlay is empty', () => {
    const committed = [a, b, c]

    expect(applyLiveNodes(committed, null)).toBe(committed)
    expect(applyLiveNodes(committed, new Map())).toBe(committed)
  })

  it('shows the entry position and flag with the committed data', () => {
    const committed = [a, retitled(b, 'changed elsewhere'), c]
    const overlay = new Map([['b', { position: { x: 410, y: 12 }, dragging: true }]])

    const shown = applyLiveNodes(committed, overlay)

    expect(shown).not.toBe(committed)
    expect(shown[1].position).toEqual({ x: 410, y: 12 })
    expect(shown[1].dragging).toBe(true)
    expect(shown[1].data.title).toBe('changed elsewhere')
    expect(shown[1].id).toBe('b')
  })

  it('keeps the committed object for a node an entry agrees with, and the others untouched', () => {
    const committed = [a, b, c]
    const overlay = new Map([
      ['a', { position: { x: 5, y: 5 }, dragging: true }],
      ['b', { position: { ...b.position }, dragging: b.dragging }],
    ])

    const shown = applyLiveNodes(committed, overlay)

    expect(shown[0].position).toEqual({ x: 5, y: 5 })
    expect(shown[1]).toBe(b)
    expect(shown[2]).toBe(c)
  })

  it('returns the committed array itself when no entry changes a node', () => {
    const committed = [a, b, c]
    const overlay = new Map([
      ['a', { position: { ...a.position } }],
      ['b', { position: { ...b.position }, dragging: false }],
    ])

    expect(applyLiveNodes(committed, overlay)).toBe(committed)
  })

  it('takes membership and the other fields from the committed nodes', () => {
    const committed = [a, b]
    const overlay = new Map([['a', { position: { x: 5, y: 5 }, dragging: true }]])

    const [shown] = applyLiveNodes(committed, overlay)

    expect(shown.position).toEqual({ x: 5, y: 5 })
    expect(shown.selected).toBe(a.selected)
    expect(shown.dragHandle).toBe(a.dragHandle)
    expect(shown.data).toBe(a.data)
  })

  it('shows a node that was added from elsewhere, where the store has it', () => {
    const committed = [a, b, c]
    const overlay = new Map([['a', { position: { x: 5, y: 5 }, dragging: true }]])

    const shown = applyLiveNodes(committed, overlay)

    expect(shown.map(node => node.id)).toEqual(['a', 'b', 'c'])
    expect(shown[2]).toBe(c)
  })

  it('drops a node that was removed from elsewhere and ignores its entry', () => {
    const overlay = new Map([
      ['a', { position: { x: 5, y: 5 }, dragging: true }],
      ['b', { position: { x: 999, y: 999 } }],
    ])

    expect(applyLiveNodes([a, c], overlay).map(node => node.id)).toEqual(['a', 'c'])
    const onlyGone = new Map([['b', { position: { x: 999, y: 999 } }]])
    expect(applyLiveNodes([a, c], onlyGone)).toEqual([a, c])
    expect(applyLiveNodes([c], overlay)).toEqual([c])
  })

  // The flip of #738 PR 3's row "an external move of a node the gesture did not move is masked":
  // the overlay holds no entry for such a node, so the committed position shows.
  it('shows an external move of a node the gesture did not move', () => {
    const overlay = new Map([['a', { position: { x: 5, y: 5 }, dragging: true }]])
    const committed = [a, moved(b, 700, 300, false), c]

    const shown = applyLiveNodes(committed, overlay)

    expect(shown[1]).toBe(committed[1])
    expect(shown[1].position).toEqual({ x: 700, y: 300 })
  })

  it('applies the flag of an entry whose position agrees, so a dragged window at its origin shows it', () => {
    const overlay = new Map([['a', { position: { ...a.position }, dragging: true }]])

    const shown = applyLiveNodes([a, b], overlay)

    expect(shown[0].dragging).toBe(true)
    expect(shown[0].position).toEqual(a.position)
    expect(shown[1]).toBe(b)
  })

  // The release applies its entries to the store's nodes with this function: a window the gesture
  // left where the store holds it is not a change, so a release with no change writes nothing.
  it('reads an absent flag and a false one alike, so a release entry at the stored position is no change', () => {
    const stored = [a, b]
    const release = new Map([['a', { position: { ...a.position }, dragging: false }]])

    expect(applyLiveNodes(stored, release)).toBe(stored)
  })
})

describe('decorateFlowNodes', () => {
  // The document holds no canvas-only field (S7): a committed node carries none of the three.
  const committed = createRowNodes(['a', 'b', 'c'])

  it('derives selected and dragHandle from the selection', () => {
    const decorated = decorateFlowNodes(committed, new Set(['b']), false)

    expect(decorated.map(node => node.selected)).toEqual([false, true, false])
    expect(decorated.map(node => node.dragHandle)).toEqual(Array(3).fill(NODE_DRAG_HANDLE_SELECTOR))
  })

  it('drops the drag handle of a selected node on the drag surface', () => {
    const decorated = decorateFlowNodes(committed, new Set(['b']), true)

    expect(decorated.map(node => node.dragHandle)).toEqual([
      NODE_DRAG_HANDLE_SELECTOR,
      undefined,
      NODE_DRAG_HANDLE_SELECTOR,
    ])
  })

  it('leaves the committed nodes without the fields', () => {
    decorateFlowNodes(committed, new Set(['b']), false)

    expect(committed.map(node => node.selected)).toEqual([undefined, undefined, undefined])
    expect(committed.map(node => node.dragHandle)).toEqual([undefined, undefined, undefined])
  })

  it('keeps the identity of the nodes that did not change', () => {
    const first = decorateFlowNodes(committed, new Set(['b']), false)
    const second = decorateFlowNodes(first, new Set(['b', 'c']), false)

    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[2]).not.toBe(first[2])
    expect(second[2].selected).toBe(true)
  })

  // The cache (S7, PR 3): the document no longer stores the flags, so a committed node never
  // equals its own view. Without a cache every node would get a new object on each decoration, and
  // React Flow would render every wrapper.
  it('gives a committed node the same view object on two decorations, in a new array', () => {
    const first = decorateFlowNodes(committed, new Set(['b']), false)
    const second = decorateFlowNodes(committed, new Set(['b']), false)

    expect(second).not.toBe(first)
    second.forEach((view, index) => expect(view).toBe(first[index]))
  })

  it('replaces only the nodes whose flags change on a selection change', () => {
    const first = decorateFlowNodes(committed, new Set(['b']), false)

    const added = decorateFlowNodes(committed, new Set(['b', 'c']), false)
    expect(added[0]).toBe(first[0])
    expect(added[1]).toBe(first[1])
    expect(added[2]).not.toBe(first[2])
    expect(added[2].selected).toBe(true)

    const swapped = decorateFlowNodes(committed, new Set(['c']), false)
    expect(swapped[0]).toBe(first[0])
    expect(swapped[1]).not.toBe(added[1])
    expect(swapped[1].selected).toBe(false)
    expect(swapped[2]).toBe(added[2])
  })

  it('replaces only the selected nodes when the drag surface mode changes', () => {
    const first = decorateFlowNodes(committed, new Set(['b']), false)

    const surface = decorateFlowNodes(committed, new Set(['b']), true)

    expect(surface[0]).toBe(first[0])
    expect(surface[1]).not.toBe(first[1])
    expect(surface[1].dragHandle).toBeUndefined()
    expect(surface[2]).toBe(first[2])
  })

  it('keeps the view of the windows of A and gives B a new one when a write changes B', () => {
    const first = decorateFlowNodes(committed, new Set(['a']), false)
    const afterWrite = [committed[0], retitled(committed[1], 'written'), committed[2]]

    const second = decorateFlowNodes(afterWrite, new Set(['a']), false)

    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect(second[1].data.title).toBe('written')
    expect(second[1].selected).toBe(false)
    expect(second[2]).toBe(first[2])
  })

  it('shows the data of the current committed node, never a view cached for an earlier one', () => {
    decorateFlowNodes(committed, new Set(), false)
    const next = retitled(committed[0], 'later')

    const [view] = decorateFlowNodes([next], new Set(), false)

    expect(view.data.title).toBe('later')
    expect(view).toEqual({ ...next, selected: false, dragHandle: NODE_DRAG_HANDLE_SELECTOR })
  })
})

describe('applyReleasedPositions', () => {
  const [a, b, c] = createRowNodes(['a', 'b', 'c'])

  it('applies the position of an entry and no flag of it', () => {
    const release = new Map([['a', { position: { x: 5, y: 30 }, dragging: false }]])

    const applied = applyReleasedPositions([a, b, c], release)

    expect(applied[0]).toEqual({ ...a, position: { x: 5, y: 30 } })
    expect('dragging' in applied[0]).toBe(false)
    expect(applied[1]).toBe(b)
    expect(applied[2]).toBe(c)
  })

  it('returns the array itself when no entry moves a node, a dragging flag included', () => {
    const nodes = [a, b, c]
    const release = new Map([['a', { position: { ...a.position }, dragging: false }]])

    expect(applyReleasedPositions(nodes, release)).toBe(nodes)
    expect(applyReleasedPositions(nodes, new Map())).toBe(nodes)
  })

  it('ignores the entry of a node that is gone', () => {
    const nodes = [a, b]
    const release = new Map([['c', { position: { x: 1, y: 1 } }]])

    expect(applyReleasedPositions(nodes, release)).toBe(nodes)
  })
})
