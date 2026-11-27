import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

import { drag, drop, ROW, setupNodeDrag as setup } from '../../support/nodeDragHarness'
import { setDocumentNodes } from '../../support/documentNodes'

// The change path of React Flow (#738, PR 4) reads the stores when a batch runs, never a copy made
// at the last render: a drag frame and a release read the live view, every other batch the
// committed view, and a store write made since the last render is part of both.

afterEach(() => {
  vi.restoreAllMocks()
})

type Setup = ReturnType<typeof setup>

const retitle = (id: string, title: string) => (nodes: Node<TerminalNodeData>[]) =>
  nodes.map(node => (node.id === id ? { ...node, data: { ...node.data, title } } : node))

const move = (id: string, y: number) => (nodes: Node<TerminalNodeData>[]) =>
  nodes.map(node => (node.id === id ? { ...node, position: { x: node.position.x, y } } : node))

function writeFromElsewhere(
  { harness }: Setup,
  change: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
): void {
  setDocumentNodes(harness.workspaceId, change(harness.readStoreDocument().nodes))
}

const titleOf = ({ harness }: Setup, id: string) =>
  harness.readStoreDocument().nodes.find(node => node.id === id)?.data.title

/** The batches that are neither a drag frame nor a release. */
const OTHER_BATCHES = [
  {
    name: 'a select batch',
    cAfter: 500,
    batch: () => [{ type: 'select', id: 'c', selected: true }] as never,
    // The selection is the slice's: a select batch writes no document (S7, PR 3).
    effect: ({ view }: Setup) =>
      expect(view.result.current.canvasState.selectedNodeIds).toEqual(['c']),
  },
  {
    name: 'a remove batch',
    cAfter: undefined,
    batch: () => [{ type: 'remove', id: 'c' }] as never,
    effect: ({ harness }: Setup) =>
      expect(harness.readStoreDocument().nodes.map(node => node.id)).toEqual(['a', 'b']),
  },
  {
    name: 'a settled move without a drag',
    cAfter: 3000,
    batch: () => drop('c', 3000, 3000),
    effect: ({ harness }: Setup) =>
      expect(harness.readStoreDocument().nodes.find(node => node.id === 'c')?.position).toEqual({
        x: 3000,
        y: 3000,
      }),
  },
] as const

describe.each(OTHER_BATCHES)('$name', ({ batch, effect, cAfter }) => {
  // The base copy of the nodes was the last render's, so a store write made since then (runtime
  // observation is synchronous) was written over.
  it('keeps a store write made since the last render', () => {
    const context = setup()

    act(() => {
      writeFromElsewhere(context, retitle('b', 'from elsewhere'))
      context.view.result.current.apply(batch())
    })

    expect(titleOf(context, 'b')).toBe('from elsewhere')
    effect(context)
  })

  it('computes from the committed view and leaves a live overlay alone', () => {
    const context = setup()
    const { harness, view, yOf } = context
    // An overlay no gesture of this hook owns, as a Space drag will publish one (PR 6). It holds
    // an entry for `c` too, so that a batch that applied it would mask the write from elsewhere.
    const live = new Map([
      ['a', { position: { x: 0, y: 30 }, dragging: true }],
      ['c', { position: { ...harness.readStoreDocument().nodes[2].position } }],
    ])
    act(() => view.result.current.interactionCommands.publishLiveNodes(live))
    const overlay = view.result.current.readInteraction().liveNodes

    act(() => {
      writeFromElsewhere(context, move('c', 500))
      view.result.current.apply(batch())
    })

    expect(view.result.current.readInteraction().liveNodes).toBe(overlay)
    expect(yOf.stored('a')).toBe(0)
    expect(yOf.shown('a')).toBe(30)
    // The write from elsewhere is part of the base, not masked by the overlay's entry for `c`.
    expect(yOf.stored('c')).toBe(cAfter)
    effect(context)
  })
})

// A batch that names no window the document holds changes none of them and writes nothing, of
// whatever kind: a select, a remove or a settled move of a window that left (a remove of a window
// that is already gone, or a late select of one) would otherwise write a copy of the committed
// nodes, with its notification and its persistence. A release needs no such guard: its write
// applies entries to the windows the store holds and writes nothing when none matches.
describe.each([
  { name: 'a select', batch: () => [{ type: 'select', id: 'gone', selected: true }] as never },
  { name: 'a remove', batch: () => [{ type: 'remove', id: 'gone' }] as never },
  { name: 'a settled move without a drag', batch: () => drop('gone', 10, 10) },
])('$name of a window the document does not hold', ({ batch }) => {
  it('writes nothing', () => {
    const { harness, view } = setup()
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()

    act(() => view.result.current.apply(batch()))

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes).toBe(nodesBefore)
  })
})

// A release and a drag frame compute from the live view: the windows the gesture holds are where
// the last frame put them, whatever the committed view says.
describe('a drag frame and a release', () => {
  // The overlay holds the gesture's windows only (S6, PR 5): a window added and moved from
  // elsewhere is not in it, so every frame and the release see it where the store has it.
  it('compute from the live view, which holds a window added and moved from elsewhere where the store has it', () => {
    const context = setup()
    const { view, runFrames, yOf, liveIds } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => writeFromElsewhere(context, nodes => [...nodes, { ...nodes[2], id: 'd' }]))
    act(() => view.result.current.apply(drag('a', 0, 60)))
    runFrames()
    act(() => writeFromElsewhere(context, move('d', 500)))
    act(() => view.result.current.apply(drag('a', 0, 90)))
    runFrames()
    expect(liveIds()).toEqual(['a'])
    expect(yOf.shown('d')).toBe(500)

    act(() => view.result.current.apply(drop('a', 0, 90)))
    expect(yOf.stored('a')).toBe(90)
    expect(yOf.stored('d')).toBe(500)
  })

  it('keep a store write made since the last render', () => {
    const context = setup()
    const { view, runFrames, yOf } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => {
      writeFromElsewhere(context, retitle('b', 'from elsewhere'))
      view.result.current.apply(drag('a', 0, 60))
    })
    runFrames()
    expect(view.result.current.shown.find(node => node.id === 'b')?.data.title).toBe(
      'from elsewhere',
    )

    act(() => {
      writeFromElsewhere(context, retitle('c', 'also from elsewhere'))
      view.result.current.apply(drop('a', 0, 60))
    })

    expect(yOf.stored('a')).toBe(60)
    expect(titleOf(context, 'b')).toBe('from elsewhere')
    expect(titleOf(context, 'c')).toBe('also from elsewhere')
  })
})

// A settled move without a drag finds a free position among the nodes of the document.
describe('normalizePosition', () => {
  const SPOT = { x: 2000, y: 1000 }
  const sizeOfA = (context: Setup) => {
    const data = context.harness.readStoreDocument().nodes[0].data
    return { width: data.width, height: data.height }
  }

  it('reads the document as it is when it runs', () => {
    const context = setup()
    const { view } = context

    let resolved = SPOT
    act(() => {
      // Runtime observation moved `c` onto the spot since the last render.
      writeFromElsewhere(context, nodes =>
        nodes.map(node => (node.id === 'c' ? { ...node, position: SPOT } : node)),
      )
      resolved = view.result.current.nodeStore.normalizePosition('a', SPOT, sizeOfA(context))
    })

    expect(resolved).not.toEqual(SPOT)
  })

  it('reads the committed positions, not the live ones of a gesture', () => {
    const context = setup()
    const { view } = context
    // The overlay puts `c` on the spot; the committed nodes, which placement reads, do not.
    const live = new Map([['c', { position: SPOT }]])
    act(() => view.result.current.interactionCommands.publishLiveNodes(live))

    const resolved = view.result.current.nodeStore.normalizePosition('a', SPOT, sizeOfA(context))

    expect(resolved).toEqual(SPOT)
  })

  it('is what a settled move without a drag resolves through', () => {
    const context = setup()
    const { view, yOf } = context

    act(() => {
      writeFromElsewhere(context, nodes =>
        nodes.map(node => (node.id === 'c' ? { ...node, position: SPOT } : node)),
      )
      view.result.current.apply(drop('a', SPOT.x, SPOT.y))
    })

    expect(yOf.stored('a')).not.toBe(SPOT.y)
  })
})

// The base is decorated from the selection slice, never from a `selected` flag of the document
// nodes. The document holds none after S7 (a write that carries one throws in development), but a
// node seeded with one stands for the two that could differ, for example after a switch back to a
// workspace: its new canvas store starts with no selection.
describe('the change path reads the selection slice, not a flag of the document', () => {
  it('a select batch selects only what the slice and the batch say', () => {
    const stale = ROW().map(node => (node.id === 'a' ? { ...node, selected: true } : node))
    const { view } = setup(stale)

    act(() => view.result.current.apply([{ type: 'select', id: 'c', selected: true }] as never))

    expect(view.result.current.canvasState.selectedNodeIds).toEqual(['c'])
    expect(
      view.result.current.canvasState.flowNodes.filter(node => node.selected).map(node => node.id),
    ).toEqual(['c'])
  })
})
