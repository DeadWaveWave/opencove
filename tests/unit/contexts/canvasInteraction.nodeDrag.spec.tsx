import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasApplyNodeChanges } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges'
import { useWorkspaceCanvasNodeDragSession } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import type { CanvasInteractionState } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.interaction'
import {
  useCanvasInteraction,
  useReadCanvasInteraction,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { applyLiveNodes } from '../../../src/contexts/workspace/presentation/renderer/utils/canvasLiveNodes'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import {
  documentOf,
  renderInTwoWorkspaces,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
  type RuntimeCanvasContext,
} from '../../support/agentRuntimeHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'

// The node drag overlay (#738, PR 3), below the canvas: what a drag frame, a release and a write
// during a gesture do to the canvas store and to the document, with the hooks the canvas wires.

const selectLiveNodes = (interaction: CanvasInteractionState) => interaction.liveNodes

afterEach(() => {
  vi.restoreAllMocks()
})

function stubFrames() {
  const frames: Array<() => void> = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(() => callback(0))
    return frames.length
  })
  return () => act(() => frames.splice(0).forEach(frame => frame()))
}

function sized(node: Node<TerminalNodeData>): Node<TerminalNodeData> {
  return { ...node, initialWidth: node.data.width, initialHeight: node.data.height }
}

/** The nodes a, b and c of a row; the store holds them sized, as the canvas does. */
const ROW = () => createRowNodes(['a', 'b', 'c']).map(sized)

function useDragUnderTest({ workspaceId, canvasState, nodeStore, publishers }: DragContext) {
  const nodeDragSession = useWorkspaceCanvasNodeDragSession({ workspaceId })
  const apply = useWorkspaceCanvasApplyNodeChanges({
    nodesRef: nodeStore.nodesRef,
    onNodesChange: publishers.publishLiveNodesChange,
    onNodesCommit: publishers.commitNodesChange,
    onSelectedNodeIdsChange: canvasState.syncSelectedNodeIds,
    clearAgentLaunchToken: nodeStore.clearAgentLaunchToken,
    normalizePosition: nodeStore.normalizePosition,
    applyPendingScrollbacks: nodeStore.applyPendingScrollbacks,
    isNodeDraggingRef: nodeStore.isNodeDraggingRef,
    nodeDragSession,
  })
  // What the flow host renders: the committed view with the overlay applied.
  const liveNodes = useCanvasInteraction(selectLiveNodes)
  const shown = applyLiveNodes(canvasState.flowNodes, liveNodes)
  return { apply, readInteraction: useReadCanvasInteraction(), shown }
}

type DragContext = CanvasNodeStoreContext | RuntimeCanvasContext

const drag = (id: string, x: number, y: number) =>
  [{ type: 'position', id, position: { x, y }, dragging: true }] as never
const drop = (id: string, x: number, y: number) =>
  [{ type: 'position', id, position: { x, y }, dragging: false }] as never

function setup() {
  const harness = createCanvasDocumentHarness({ nodes: ROW() })
  const view = renderCanvasNodeStore(harness, { extend: useDragUnderTest })
  const runFrames = stubFrames()
  /** The y of node `id` as the host shows it, as the document holds it, and in the overlay. */
  const yOf = {
    shown: (id: string) => view.result.current.shown.find(node => node.id === id)?.position.y,
    stored: (id: string) =>
      harness.readStoreDocument().nodes.find(node => node.id === id)?.position.y,
    live: (id: string) =>
      view.result.current.readInteraction().liveNodes?.find(node => node.id === id)?.position.y,
  }
  return { harness, view, runFrames, yOf }
}

describe('a node drag frame', () => {
  it('writes the overlay and leaves the document and the committed view alone', () => {
    const { harness, view, runFrames, yOf } = setup()
    const committedView = view.result.current.canvasState.flowNodes
    harness.notifications.mockClear()

    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    expect(yOf.live('a')).toBe(30)
    expect(yOf.shown('a')).toBe(30)
    expect(yOf.stored('a')).toBe(0)
    expect(view.result.current.canvasState.flowNodes).toBe(committedView)
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('publishes every node as of the frame, the dragged one at its live position', () => {
    const { view, runFrames } = setup()

    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    const live = view.result.current.readInteraction().liveNodes
    expect(live?.map(node => [node.id, node.position.y])).toEqual([
      ['a', 30],
      ['b', 0],
      ['c', 0],
    ])
  })
})

describe('a release', () => {
  it('writes the document once, clears the overlay and shows the released position', () => {
    const { harness, view, runFrames, yOf } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    harness.notifications.mockClear()

    act(() => view.result.current.apply(drop('a', 0, 40)))

    expect(yOf.stored('a')).toBe(40)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(yOf.shown('a')).toBe(40)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })

  it('shows no position before the drag, at any render from the first live frame on', () => {
    const { view, runFrames } = setup()
    const log: Array<number | undefined> = []
    const record = () =>
      log.push(view.result.current.shown.find(node => node.id === 'a')?.position.y)

    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    record()
    act(() => view.result.current.apply(drag('a', 0, 60)))
    runFrames()
    record()
    act(() => view.result.current.apply(drop('a', 0, 60)))
    record()

    expect(log).toEqual([30, 60, 60])
  })
})

// Today's semantics, pinned so that the change that retires `nodesRef` flips it on purpose (S6,
// PR 4): a canvas write during a gesture commits the live positions, ends the overlay, and the
// host shows no jump.
describe('a canvas write in the middle of a gesture', () => {
  it('commits the live positions, ends the overlay and shows no jump', () => {
    const { harness, view, runFrames, yOf } = setup()
    const shown: Array<number | undefined> = []
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    shown.push(yOf.shown('a'))
    expect(yOf.stored('a')).toBe(0)

    act(() => {
      view.result.current.nodeStore.setNodes(nodes =>
        nodes.map(node =>
          node.id === 'b' ? { ...node, data: { ...node.data, title: 'renamed' } } : node,
        ),
      )
    })
    shown.push(yOf.shown('a'))

    expect(harness.readStoreDocument().nodes.find(node => node.id === 'b')?.data.title).toBe(
      'renamed',
    )
    expect(yOf.stored('a')).toBe(30)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(shown).toEqual([30, 30])

    // The gesture goes on from the committed live position, and its release lands.
    act(() => view.result.current.apply(drag('a', 0, 50)))
    runFrames()
    expect(yOf.shown('a')).toBe(50)
    act(() => view.result.current.apply(drop('a', 0, 50)))
    expect(yOf.stored('a')).toBe(50)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
  })

  it('does not flush the live positions unless the write asks for it', () => {
    const { harness, view, runFrames } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    harness.flush.mockClear()

    act(() => view.result.current.nodeStore.setNodes(nodes => nodes.map(node => ({ ...node }))))

    expect(harness.flush).not.toHaveBeenCalled()
  })
})

// The corner of the base that the overlay's base changes (S6, PR 3): after a write from elsewhere
// in the middle of a gesture, where do the windows the gesture did not move stand in the next
// frame and in the release? The same rows ran on the base (through a shim) and gave the same
// result, which is pinned here as today's rule; PR 5 narrows the overlay and flips the first row.
describe('a write from elsewhere in the middle of a gesture', () => {
  it("keeps the old live position of a window the gesture did not move, through the release (today's rule)", () => {
    const { harness, view, runFrames, yOf } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        harness
          .readStoreDocument()
          .nodes.map(node =>
            node.id === 'c' ? { ...node, position: { x: node.position.x, y: 500 } } : node,
          ),
      )
    })
    expect(yOf.shown('c')).toBe(0)

    act(() => view.result.current.apply(drag('a', 0, 60)))
    runFrames()
    expect(yOf.live('c')).toBe(0)
    act(() => view.result.current.apply(drop('a', 0, 60)))

    expect(yOf.stored('a')).toBe(60)
    expect(yOf.stored('c')).toBe(0)
  })

  it('shows a title changed from elsewhere with the live position', () => {
    const { harness, view, runFrames, yOf } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        harness
          .readStoreDocument()
          .nodes.map(node =>
            node.id === 'a' ? { ...node, data: { ...node.data, title: 'from elsewhere' } } : node,
          ),
      )
    })

    const shownA = view.result.current.shown.find(node => node.id === 'a')
    expect(shownA?.data.title).toBe('from elsewhere')
    expect(yOf.shown('a')).toBe(30)
  })
})

// The provider creates a store for each workspace, so a gesture of A never reaches B; a release
// that React Flow delivers after the switch finds none of A's nodes in B and writes nothing.
describe('a gesture across a workspace switch', () => {
  function renderTwoWorkspaces() {
    const a = ROW()
    const x = createRowNodes(['x', 'y']).map(sized)
    return renderInTwoWorkspaces(context => useDragUnderTest(context), {
      a: { nodes: a },
      b: { nodes: x },
    })
  }

  it('starts the new workspace with no overlay, guides or preview', () => {
    const { view, showB } = renderTwoWorkspaces()
    const runFrames = stubFrames()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    expect(view.result.current.readInteraction().liveNodes).not.toBeNull()
    const interactionOfA = view.result.current.readInteraction

    showB()

    const next = view.result.current.readInteraction()
    expect(next.liveNodes).toBeNull()
    expect(next.snapGuides).toBeNull()
    expect(next.nodeDragFramePreview).toBeNull()
    expect(interactionOfA().liveNodes).not.toBeNull()
  })

  it('writes neither document when the release arrives after the switch', () => {
    const { harness, view, showB } = renderTwoWorkspaces()
    const runFrames = stubFrames()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    const nodesOfA = documentOf(A).nodes
    const nodesOfB = documentOf(B).nodes
    showB()
    harness.notifications.mockClear()

    act(() => view.result.current.apply(drop('a', 0, 30)))

    expect(documentOf(A).nodes).toBe(nodesOfA)
    expect(documentOf(B).nodes).toBe(nodesOfB)
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
  })
})
