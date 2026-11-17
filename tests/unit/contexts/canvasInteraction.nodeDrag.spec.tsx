import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  documentOf,
  renderInTwoWorkspaces,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
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
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'

// The node drag overlay (#738, PR 3), below the canvas: what a drag frame, a release and a write
// during a gesture do to the canvas store and to the document, with the hooks the canvas wires.

afterEach(() => {
  vi.restoreAllMocks()
})

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

  // The overlay holds the gesture's windows only (S6, PR 5): the dragged one, at its live position.
  it('publishes only the window the gesture owns, at its live position', () => {
    const { view, runFrames, liveIds } = setup()

    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    expect(liveIds()).toEqual(['a'])
    expect(view.result.current.readInteraction().liveNodes?.get('a')).toEqual({
      position: { x: 0, y: 30 },
      dragging: true,
    })
  })

  it('keeps the overlay itself when a frame changes nothing', () => {
    const { view, runFrames } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    const overlay = view.result.current.readInteraction().liveNodes

    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    expect(view.result.current.readInteraction().liveNodes).toBe(overlay)
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

  // The two writes are one synchronous block, and React renders them in one batch in a browser.
  // The order still matters for any render in between: the document first, so that a render sees
  // the overlay over the released nodes, never the nodes before the drag.
  it('writes the document before it clears the overlay', () => {
    const { harness, view, runFrames } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    const overlayWhenTheDocumentIsWritten: boolean[] = []
    const unsubscribe = useAppStore.subscribe(() => {
      overlayWhenTheDocumentIsWritten.push(view.result.current.readInteraction().liveNodes !== null)
    })

    act(() => view.result.current.apply(drop('a', 0, 40)))
    unsubscribe()

    expect(harness.readStoreDocument().nodes.find(node => node.id === 'a')?.position.y).toBe(40)
    expect(overlayWhenTheDocumentIsWritten).toEqual([true])
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
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

// A canvas write during a gesture computes from the committed view (S6, PR 4): it commits the
// committed positions, leaves the overlay alone, and the host goes on showing the live position.
// The dragged windows reach the document at the release. Until PR 4 it committed their live
// positions and ended the overlay.
describe('a canvas write in the middle of a gesture', () => {
  const retitleB = (nodes: Node<TerminalNodeData>[]) =>
    nodes.map(node =>
      node.id === 'b' ? { ...node, data: { ...node.data, title: 'renamed' } } : node,
    )

  it('commits the committed positions, leaves the overlay and shows the live position', () => {
    const { harness, view, runFrames, yOf } = setup()
    const shown: Array<number | undefined> = []
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    shown.push(yOf.shown('a'))
    expect(yOf.stored('a')).toBe(0)
    const overlay = view.result.current.readInteraction().liveNodes

    act(() => {
      view.result.current.nodeStore.setNodes(retitleB)
    })
    shown.push(yOf.shown('a'))

    expect(harness.readStoreDocument().nodes.find(node => node.id === 'b')?.data.title).toBe(
      'renamed',
    )
    expect(yOf.stored('a')).toBe(0)
    expect(view.result.current.readInteraction().liveNodes).toBe(overlay)
    expect(yOf.live('a')).toBe(30)
    expect(shown).toEqual([30, 30])
    expect(view.result.current.shown.find(node => node.id === 'b')?.data.title).toBe('renamed')

    // The gesture goes on, and its release lands.
    act(() => view.result.current.apply(drag('a', 0, 50)))
    runFrames()
    expect(yOf.shown('a')).toBe(50)
    expect(yOf.stored('a')).toBe(0)
    act(() => view.result.current.apply(drop('a', 0, 50)))
    expect(yOf.stored('a')).toBe(50)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
  })

  it('does not flush unless the write asks for it, and then flushes the committed positions', () => {
    const { harness, view, runFrames } = setup()
    const positionsAtFlush: Array<number | undefined> = []
    harness.flush.mockImplementation(() => {
      positionsAtFlush.push(
        harness.readStoreDocument().nodes.find(node => node.id === 'a')?.position.y,
      )
    })
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    harness.flush.mockClear()

    act(() => view.result.current.nodeStore.setNodes(nodes => nodes.map(node => ({ ...node }))))
    expect(harness.flush).not.toHaveBeenCalled()

    act(() => view.result.current.nodeStore.setNodes(retitleB, { flush: true }))
    expect(positionsAtFlush).toEqual([0])
  })

  it('hands a recipe the committed positions of the dragged windows, never the live ones', () => {
    const { view, runFrames } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    const seen: Array<number | undefined> = []

    act(() => {
      view.result.current.nodeStore.updateCanvasDocument(({ nodes, spaces }) => {
        seen.push(nodes.find(node => node.id === 'a')?.position.y)
        return { nodes, spaces }
      })
    })

    expect(seen).toEqual([0])
  })
})

// A write from elsewhere in the middle of a gesture (S6, PR 5): the overlay holds the gesture's
// windows only, so a window the gesture did not move shows where the store now has it and keeps
// that place through the release. Until PR 5 the overlay held every window as of the last frame:
// such a move was masked on screen and overwritten at the release.
describe('a write from elsewhere in the middle of a gesture', () => {
  it('shows a window the gesture did not move where the store has it, and keeps it through the release', () => {
    const { harness, view, runFrames, yOf, liveIds } = setup()
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
    expect(yOf.shown('c')).toBe(500)

    act(() => view.result.current.apply(drag('a', 0, 60)))
    runFrames()
    expect(yOf.shown('c')).toBe(500)
    expect(liveIds()).not.toContain('b')
    act(() => view.result.current.apply(drop('a', 0, 60)))

    expect(yOf.stored('a')).toBe(60)
    expect(yOf.stored('c')).toBe(500)
    expect(yOf.shown('c')).toBe(500)
  })

  // A small step of the pointer skips the projection of the other windows, and a big one (24 px or
  // more) runs it and sets every window it did not move back to its baseline. After neither does
  // the overlay hold a window the gesture did not move, so a second move of it shows at once.
  it.each([
    { kind: 'a small step', y: 34 },
    { kind: 'a big step', y: 200 },
  ])('shows a window moved twice from elsewhere at once, after $kind', ({ y }) => {
    const { harness, view, runFrames, yOf, liveIds } = setup()
    const moveC = (to: number) =>
      act(() => {
        replaceWorkspaceNodes(
          harness.workspaceId,
          harness
            .readStoreDocument()
            .nodes.map(node =>
              node.id === 'c' ? { ...node, position: { x: node.position.x, y: to } } : node,
            ),
        )
      })
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    moveC(500)
    act(() => view.result.current.apply(drag('a', 0, y)))
    runFrames()
    expect(liveIds()).toEqual(['a'])
    expect(yOf.shown('c')).toBe(500)

    moveC(700)

    expect(yOf.shown('c')).toBe(700)
    act(() => view.result.current.apply(drop('a', 0, y)))
    expect(yOf.stored('c')).toBe(700)
  })

  // The rule is "the overlay holds the windows the gesture owns", so a window added from elsewhere
  // during the gesture and moved from elsewhere after it is never masked.
  it('shows a window added from elsewhere and moved from elsewhere after, and keeps it', () => {
    const { harness, view, runFrames, yOf } = setup()
    const nodesWith = (change: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) =>
      act(() => {
        replaceWorkspaceNodes(harness.workspaceId, change(harness.readStoreDocument().nodes))
      })
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    const added = sized({ ...createRowNodes(['d'])[0], position: { x: 1200, y: 0 } })
    nodesWith(nodes => [...nodes, added])
    act(() => view.result.current.apply(drag('a', 0, 60)))
    runFrames()
    expect(yOf.shown('d')).toBe(0)

    nodesWith(nodes =>
      nodes.map(node => (node.id === 'd' ? { ...node, position: { x: 1200, y: 500 } } : node)),
    )
    act(() => view.result.current.apply(drag('a', 0, 90)))
    runFrames()

    expect(yOf.shown('d')).toBe(500)
    act(() => view.result.current.apply(drop('a', 0, 90)))
    expect(yOf.stored('a')).toBe(90)
    expect(yOf.stored('d')).toBe(500)
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

// A canvas writer that moves a window the gesture did not move (a push-away, an arrange, a
// collapse plan) meets the same rule: the move is committed, shown at once, and still there after
// the release. Until PR 5 it was masked on screen and overwritten at the release (before PR 4 it
// showed for one frame and was reset by the next).
describe('a canvas write that moves a window the gesture did not move', () => {
  const moveC = (nodes: Node<TerminalNodeData>[]) =>
    nodes.map(node => (node.id === 'c' ? { ...node, position: { x: 2500, y: 0 } } : node))
  const xOf = (view: ReturnType<typeof setup>['view'], id: string) =>
    view.result.current.shown.find(node => node.id === id)?.position.x

  it('is shown at once, in the frames that follow, and after the release', () => {
    const { harness, view, runFrames } = setup()
    const storedX = () =>
      harness.readStoreDocument().nodes.find(node => node.id === 'c')?.position.x
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => view.result.current.nodeStore.setNodes(moveC))
    expect(storedX()).toBe(2500)
    expect(xOf(view, 'c')).toBe(2500)

    act(() => view.result.current.apply(drag('a', 0, 60)))
    runFrames()
    expect(xOf(view, 'c')).toBe(2500)

    act(() => view.result.current.apply(drop('a', 0, 60)))
    expect(storedX()).toBe(2500)
    expect(xOf(view, 'c')).toBe(2500)
    expect(harness.readStoreDocument().nodes.find(node => node.id === 'a')?.position.y).toBe(60)
  })
})

// A window that the drag did not hold at its start has no baseline, so the overlay never holds it:
// a canvas writer's move of it shows and survives the release. Before PR 4 it survived; PR 4 masked
// and overwrote it; from PR 5 it is kept again, and for the same reason as any other untouched one.
describe('a window created during the drag, then moved by a canvas writer', () => {
  const addD = (nodes: Node<TerminalNodeData>[]) => [
    ...nodes,
    { ...nodes[2], id: 'd', position: { x: 3000, y: 0 } },
  ]
  const moveD = (nodes: Node<TerminalNodeData>[]) =>
    nodes.map(node => (node.id === 'd' ? { ...node, position: { x: 5000, y: 0 } } : node))

  it('is shown where it was moved to and keeps that place through the release', () => {
    const { harness, view, runFrames } = setup()
    const xOf = () => harness.readStoreDocument().nodes.find(node => node.id === 'd')?.position.x
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    act(() => view.result.current.nodeStore.setNodes(addD))
    act(() => view.result.current.apply(drag('a', 0, 40)))
    runFrames()

    act(() => view.result.current.nodeStore.setNodes(moveD))
    expect(xOf()).toBe(5000)
    expect(view.result.current.shown.find(node => node.id === 'd')?.position.x).toBe(5000)

    act(() => view.result.current.apply(drag('a', 0, 50)))
    runFrames()
    expect(view.result.current.shown.find(node => node.id === 'd')?.position.x).toBe(5000)
    act(() => view.result.current.apply(drop('a', 0, 50)))
    expect(xOf()).toBe(5000)
  })
})

// After a write from elsewhere the canvas write still computes from the committed view, and the
// overlay still stays (S6, PR 4). A select batch while a drag is live is a release (the gesture
// ends with it), so it computes from the live view as before.
describe('a canvas write after a write from elsewhere, before the next frame', () => {
  const retitle = (id: string, title: string) => (nodes: Node<TerminalNodeData>[]) =>
    nodes.map(node => (node.id === id ? { ...node, data: { ...node.data, title } } : node))

  it('commits the committed positions, leaves the overlay and shows no jump', () => {
    const { harness, view, runFrames, yOf } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        retitle('b', 'from elsewhere')(harness.readStoreDocument().nodes),
      )
    })
    expect(yOf.shown('a')).toBe(30)

    act(() => view.result.current.nodeStore.setNodes(retitle('c', 'renamed')))

    expect(yOf.stored('a')).toBe(0)
    expect(yOf.live('a')).toBe(30)
    expect(yOf.shown('a')).toBe(30)
    expect(harness.readStoreDocument().nodes.find(node => node.id === 'b')?.data.title).toBe(
      'from elsewhere',
    )
    expect(harness.readStoreDocument().nodes.find(node => node.id === 'c')?.data.title).toBe(
      'renamed',
    )
  })

  it('a select batch right after a write from elsewhere commits the live position', () => {
    const { harness, view, runFrames, yOf } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        retitle('b', 'from elsewhere')(harness.readStoreDocument().nodes),
      )
    })

    act(() => view.result.current.apply([{ type: 'select', id: 'b', selected: true }] as never))

    expect(yOf.stored('a')).toBe(30)
    expect(yOf.shown('a')).toBe(30)
  })
})

// Outside a gesture a canvas write computes from the store, so a position written since the last
// render is kept.
describe('a canvas write with no gesture live', () => {
  it('keeps a position the store received since the last render', () => {
    const { harness, view, yOf } = setup()

    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        harness
          .readStoreDocument()
          .nodes.map(node =>
            node.id === 'c' ? { ...node, position: { x: node.position.x, y: 500 } } : node,
          ),
      )
      view.result.current.nodeStore.setNodes(nodes =>
        nodes.map(node =>
          node.id === 'b' ? { ...node, data: { ...node.data, title: 'renamed' } } : node,
        ),
      )
    })

    expect(yOf.stored('c')).toBe(500)
  })
})

// A release that names no window this canvas still holds (a selection drag whose windows were all
// removed from elsewhere) writes nothing, and the gesture still ends.
describe('a release whose windows were all removed from elsewhere', () => {
  it('writes nothing and ends the overlay', () => {
    const { harness, view, runFrames, yOf } = setup()
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        harness.readStoreDocument().nodes.filter(node => node.id !== 'a'),
      )
    })
    const nodesBefore = harness.readStoreDocument().nodes

    act(() => view.result.current.apply(drop('a', 0, 30)))

    expect(harness.readStoreDocument().nodes).toBe(nodesBefore)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(yOf.shown('b')).toBe(yOf.stored('b'))
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

  // The change path reads the document of the render that made it: a batch applied by the
  // callback of A after the switch (Inner is not keyed by workspace) is A's.
  it('writes the workspace it was made for when a batch is applied after the switch', () => {
    const { view, showB } = renderTwoWorkspaces()
    const applyOfA = view.result.current.apply
    const nodesOfB = documentOf(B).nodes
    showB()

    act(() => applyOfA([{ type: 'select', id: 'a', selected: true }] as never))

    expect(documentOf(A).nodes.find(node => node.id === 'a')?.selected).toBe(true)
    expect(documentOf(B).nodes).toBe(nodesOfB)
  })

  // A release that reaches the callback of A after the switch still lands in A, where the drag
  // began: the dragged window is stored at the release position and B is untouched. The switch
  // resets `isNodeDraggingRef` (S6, PR 5), so this batch is a settled move, not a release: the
  // overlay of A, which lives in A's own store and which nothing reads after the switch, is not
  // ended by it. (PR 4 pinned "A's overlay ends"; that part is gone with the reset.)
  it('lands a release delivered to the callback of A after the switch in A', () => {
    const { view, showB } = renderTwoWorkspaces()
    const runFrames = stubFrames()
    const applyOfA = view.result.current.apply
    act(() => applyOfA(drag('a', 0, 30)))
    runFrames()
    const nodesOfB = documentOf(B).nodes
    showB()

    act(() => applyOfA(drop('a', 0, 40)))

    expect(documentOf(A).nodes.find(node => node.id === 'a')?.position.y).toBe(40)
    expect(documentOf(B).nodes).toBe(nodesOfB)
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
