import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { drag, drop, ROW, setupNodeDrag as setup } from '../../support/nodeDragHarness'

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
  replaceWorkspaceNodes(harness.workspaceId, change(harness.readStoreDocument().nodes))
}

const titleOf = ({ harness }: Setup, id: string) =>
  harness.readStoreDocument().nodes.find(node => node.id === id)?.data.title

/** The batches that are neither a drag frame nor a release. */
const OTHER_BATCHES = [
  {
    name: 'a select batch',
    cAfter: 500,
    batch: () => [{ type: 'select', id: 'c', selected: true }] as never,
    effect: ({ harness }: Setup) =>
      expect(harness.readStoreDocument().nodes.find(node => node.id === 'c')?.selected).toBe(true),
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
    // An overlay no gesture of this hook owns, as a Space drag will publish one (PR 6).
    const live = harness.readStoreDocument().nodes.map(node => ({
      ...node,
      position: node.id === 'a' ? { x: node.position.x, y: 30 } : node.position,
    }))
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

// A release and a drag frame compute from the live view: the windows the gesture holds are where
// the last frame put them, whatever the committed view says.
describe('a drag frame and a release', () => {
  it('compute from the live view, which holds a window added and moved from elsewhere as of the last frame', () => {
    const context = setup()
    const { view, runFrames, yOf } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => writeFromElsewhere(context, nodes => [...nodes, { ...nodes[2], id: 'd' }]))
    act(() => view.result.current.apply(drag('a', 0, 60)))
    runFrames()
    act(() => writeFromElsewhere(context, move('d', 500)))
    act(() => view.result.current.apply(drag('a', 0, 90)))
    runFrames()
    expect(yOf.live('d')).toBe(0)

    act(() => view.result.current.apply(drop('a', 0, 90)))
    expect(yOf.stored('a')).toBe(90)
    expect(yOf.stored('d')).toBe(0)
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
    const { harness, view } = context
    const live = harness
      .readStoreDocument()
      .nodes.map(node => (node.id === 'c' ? { ...node, position: SPOT } : node))
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

// The base is decorated from the selection slice, not from the `selected` mirror of the document
// nodes. The two differ, for example, after a switch back to a workspace: its new canvas store
// starts with no selection while its document nodes still say `selected: true`.
describe('the change path reads the selection slice, not the document mirror', () => {
  it('a select batch selects only what the slice and the batch say', () => {
    const stale = ROW().map(node => (node.id === 'a' ? { ...node, selected: true } : node))
    const { harness, view } = setup(stale)

    act(() => view.result.current.apply([{ type: 'select', id: 'c', selected: true }] as never))

    expect(
      harness
        .readStoreDocument()
        .nodes.filter(node => node.selected)
        .map(node => node.id),
    ).toEqual(['c'])
  })
})
