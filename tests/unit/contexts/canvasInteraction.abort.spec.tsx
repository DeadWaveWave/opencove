import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  renderInTwoWorkspaces,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
  documentOf,
} from '../../support/agentRuntimeHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'
import {
  drag,
  drop,
  ROW,
  setupNodeDrag as setup,
  sizedNode as sized,
  stubFrames,
  useDragUnderTest,
} from '../../support/nodeDragHarness'
import { setDocumentNodes } from '../../support/documentNodes'

// A gesture that ends without a release (#738, PR 5). React Flow aborts a node-handle drag when the
// window it grabbed leaves its node lookup, and sends no release; a workspace switch leaves the
// drag of the old workspace unfinished. Neither may leave the overlay, the drag session or
// `isNodeDraggingRef` set, or the next click acts as the release of a drag that never ended.

afterEach(() => {
  vi.restoreAllMocks()
})

type Setup = ReturnType<typeof setup>

const moveTo = (id: string, x: number, y: number) => (nodes: Node<TerminalNodeData>[]) =>
  nodes.map(node => (node.id === id ? { ...node, position: { x, y } } : node))

const removeNode = (id: string) => (nodes: Node<TerminalNodeData>[]) =>
  nodes.filter(node => node.id !== id)

function fromElsewhere(
  { harness }: Setup,
  change: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
) {
  act(() => {
    setDocumentNodes(harness.workspaceId, change(harness.readStoreDocument().nodes))
  })
}

const isDragging = ({ view }: Setup) => view.result.current.nodeStore.isNodeDraggingRef.current
const hasSession = ({ view }: Setup) =>
  view.result.current.nodeDragSession.dragBaselinePositionByIdRef.current !== null

// With the pointer anchor the canvas's drag start records, and without it (a touch drag): then a
// drag that moves exactly one window grabbed that window.
describe.each([
  { how: 'the pointer anchor names the grabbed window', anchored: true },
  { how: 'no anchor, one dragged window', anchored: false },
])('the window a drag grabbed leaves the document ($how)', ({ anchored }) => {
  function dragAndRemoveA() {
    const context = setup()
    const { view, runFrames } = context
    if (anchored) {
      context.grab('a')
    }
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    expect(isDragging(context)).toBe(true)
    expect(hasSession(context)).toBe(true)
    expect(context.liveIds()).toEqual(['a'])
    context.harness.notifications.mockClear()
    fromElsewhere(context, removeNode('a'))
    return context
  }

  it('ends the overlay, the drag session and the dragging flag, and writes nothing more', () => {
    const context = dragAndRemoveA()
    const { harness, view } = context

    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(isDragging(context)).toBe(false)
    expect(hasSession(context)).toBe(false)
    expect(view.result.current.readInteraction().snapGuides).toBeNull()
    expect(view.result.current.readInteraction().nodeDragFramePreview).toBeNull()
    // The removal from elsewhere is the only write.
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().nodes.map(node => node.id)).toEqual(['b', 'c'])
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('shows a move from elsewhere and a canvas move at once, where a stuck overlay masked them', () => {
    const context = dragAndRemoveA()
    const { view, yOf } = context

    fromElsewhere(context, moveTo('b', 400, 700))
    act(() => view.result.current.nodeStore.setNodes(moveTo('c', 2500, 0)))

    expect(yOf.shown('b')).toBe(700)
    expect(view.result.current.shown.find(node => node.id === 'c')?.position.x).toBe(2500)
  })

  it('treats the next click as a plain select, not as the release of the aborted drag', () => {
    const context = dragAndRemoveA()
    const { harness, view, yOf } = context
    fromElsewhere(context, moveTo('b', 400, 700))
    act(() => view.result.current.nodeStore.setNodes(moveTo('c', 2500, 0)))
    harness.notifications.mockClear()

    act(() => view.result.current.apply([{ type: 'select', id: 'c', selected: true }] as never))

    expect(yOf.stored('b')).toBe(700)
    expect(harness.readStoreDocument().nodes.find(node => node.id === 'c')?.position.x).toBe(2500)
    // The click selects: the selection is the slice's, and the batch writes no document.
    expect(view.result.current.canvasState.selectedNodeIds).toEqual(['c'])
    expect(isDragging(context)).toBe(false)
    expect(harness.notifications).not.toHaveBeenCalled()
  })

  it('does not start the gesture again from a frame that was waiting for its animation frame', () => {
    const context = setup()
    const { view, runFrames } = context
    if (anchored) {
      context.grab('a')
    }
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    act(() => view.result.current.apply(drag('a', 0, 60)))

    fromElsewhere(context, removeNode('a'))
    runFrames()

    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(isDragging(context)).toBe(false)
    expect(hasSession(context)).toBe(false)
  })

  it('lets the next drag of another window begin its own session', () => {
    const context = dragAndRemoveA()
    const { view, runFrames, yOf } = context

    act(() => view.result.current.apply(drag('b', 400, 50)))
    runFrames()
    expect(hasSession(context)).toBe(true)
    expect(yOf.shown('b')).toBe(50)
    act(() => view.result.current.apply(drop('b', 400, 60)))

    expect(yOf.stored('b')).toBe(60)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
  })
})

// The abort ends the gesture and writes nothing: the other windows the drag was moving stay where
// the store has them, the Space selection the drag start captured is dropped.
describe('the grabbed window of a drag of several windows leaves the document', () => {
  it('writes none of the windows the drag was still moving, and drops what the drag start captured', () => {
    const context = setup()
    const { harness, view, runFrames, yOf } = context
    context.grab('a')
    act(() => view.result.current.nodeDragSession.captureDragStartSpaceSelection())
    act(() =>
      view.result.current.apply([
        { type: 'position', id: 'a', position: { x: 0, y: 30 }, dragging: true },
        { type: 'position', id: 'b', position: { x: 400, y: 30 }, dragging: true },
      ] as never),
    )
    runFrames()
    expect(yOf.shown('b')).toBe(30)
    harness.notifications.mockClear()

    fromElsewhere(context, removeNode('a'))

    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(yOf.stored('b')).toBe(0)
    expect(yOf.shown('b')).toBe(0)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).not.toHaveBeenCalled()
    expect(view.result.current.nodeDragSession.getDragStartSpaceSelection()).toBeNull()
  })

  // A drag that replaced the selection with the grabbed window holds an exclusive anchor, which
  // drops the position changes of every other window until the drag ends.
  it('drops the exclusive anchor of a drag that replaced the selection', () => {
    const context = setup()
    const { view, runFrames } = context
    context.grab('a')
    view.result.current.exclusiveNodeDragAnchorIdRef.current = 'a'
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    expect(view.result.current.exclusiveNodeDragAnchorIdRef.current).toBe('a')

    fromElsewhere(context, removeNode('a'))

    expect(view.result.current.exclusiveNodeDragAnchorIdRef.current).toBeNull()
  })
})

describe('a window the drag did not grab leaves the document', () => {
  it('leaves the gesture alone, and its release still lands', () => {
    const context = setup()
    const { view, runFrames, yOf } = context
    context.grab('a')
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    fromElsewhere(context, removeNode('c'))

    expect(isDragging(context)).toBe(true)
    expect(context.liveIds()).toEqual(['a'])
    act(() => view.result.current.apply(drag('a', 0, 50)))
    runFrames()
    act(() => view.result.current.apply(drop('a', 0, 50)))
    expect(yOf.stored('a')).toBe(50)
    expect(isDragging(context)).toBe(false)
  })

  it('leaves a drag of several windows alone when the grabbed one stays', () => {
    const context = setup()
    const { view, runFrames } = context
    context.grab('a')
    const both = [
      { type: 'position', id: 'a', position: { x: 0, y: 30 }, dragging: true },
      { type: 'position', id: 'b', position: { x: 400, y: 30 }, dragging: true },
    ] as never
    act(() => view.result.current.apply(both))
    runFrames()

    fromElsewhere(context, removeNode('b'))

    expect(isDragging(context)).toBe(true)
    expect(context.liveIds()).toEqual(['a', 'b'])
  })

  it('does nothing when no gesture is live', () => {
    const context = setup()

    fromElsewhere(context, removeNode('a'))

    expect(isDragging(context)).toBe(false)
    expect(context.harness.notifications).toHaveBeenCalledTimes(1)
  })
})

// The canvas is not keyed by workspace: `isNodeDraggingRef` outlives a switch unless it is reset,
// and React Flow aborts the drag of A when its window leaves the lookup, so B's first drag would
// start as the continuation of A's: no session, no baseline.
describe('a workspace switch in the middle of a drag', () => {
  function renderTwoWorkspaces() {
    return renderInTwoWorkspaces(
      context => ({ ...useDragUnderTest(context), nodeStore: context.nodeStore }),
      {
        a: { nodes: ROW() },
        b: { nodes: createRowNodes(['x', 'y']).map(sized) },
      },
    )
  }

  it('resets the dragging flag, so the next drag in B begins its own session', () => {
    const { view, showB } = renderTwoWorkspaces()
    const runFrames = stubFrames()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    expect(view.result.current.nodeStore.isNodeDraggingRef.current).toBe(true)

    showB()

    expect(view.result.current.nodeStore.isNodeDraggingRef.current).toBe(false)
    act(() => view.result.current.apply(drag('x', 0, 20)))
    runFrames()
    expect(view.result.current.nodeDragSession.dragBaselinePositionByIdRef.current?.has('x')).toBe(
      true,
    )
    expect(view.result.current.readInteraction().liveNodes?.get('x')?.position.y).toBe(20)
    act(() => view.result.current.apply(drop('x', 0, 25)))
    expect(documentOf(B).nodes.find(node => node.id === 'x')?.position.y).toBe(25)
    expect(documentOf(A).nodes.find(node => node.id === 'a')?.position.y).toBe(0)
  })
})
