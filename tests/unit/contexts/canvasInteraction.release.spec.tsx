import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { drag, drop, setupNodeDrag as setup, sizedNode } from '../../support/nodeDragHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'
import { setDocumentNodes } from '../../support/documentNodes'

// The release of a node gesture is one write (#738, PR 5): the windows the gesture owns, at their
// release position, applied to the store's nodes as they are when it runs, and, in a Space-dominant
// drag, the Space frames with them. Nothing else of the release array reaches the document.

afterEach(() => {
  vi.restoreAllMocks()
})

const storedNode = (context: ReturnType<typeof setup>, id: string) =>
  context.harness.readStoreDocument().nodes.find(node => node.id === id)!

describe('the release of an ordinary drag', () => {
  it('lands the dragged window at its release position, snap included', () => {
    const context = setup(undefined, { magneticSnapping: true })
    const { view, runFrames, yOf } = context
    act(() => view.result.current.apply(drag('c', 803, 4)))
    runFrames()
    expect(view.result.current.readInteraction().snapGuides).not.toBeNull()
    expect(yOf.shown('c')).toBe(4)

    act(() => view.result.current.apply(drop('c', 803, 4)))

    // The frame was 4 px below the top edge of its neighbours; the release is on it.
    expect(storedNode(context, 'c').position).toEqual({ x: 803, y: 0 })
    expect(yOf.shown('c')).toBe(0)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(view.result.current.readInteraction().snapGuides).toBeNull()
  })

  it('writes one notification, with no flush, and leaves the other windows as they are', () => {
    const context = setup()
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    const untouched = { b: storedNode(context, 'b'), c: storedNode(context, 'c') }
    harness.notifications.mockClear()

    act(() => view.result.current.apply(drop('a', 0, 40)))

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).not.toHaveBeenCalled()
    expect(storedNode(context, 'a').position.y).toBe(40)
    // The object of a window the gesture did not move is the store's own, not a copy.
    expect(storedNode(context, 'b')).toBe(untouched.b)
    expect(storedNode(context, 'c')).toBe(untouched.c)
  })

  it('keeps the move of another window that arrives in the same call as the release', () => {
    const context = setup()
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => {
      setDocumentNodes(
        harness.workspaceId,
        harness
          .readStoreDocument()
          .nodes.map(node => (node.id === 'b' ? { ...node, position: { x: 400, y: 700 } } : node)),
      )
      view.result.current.apply(drop('a', 0, 40))
    })

    expect(storedNode(context, 'b').position).toEqual({ x: 400, y: 700 })
    expect(storedNode(context, 'a').position.y).toBe(40)
  })

  it('writes the dragged windows of a multi-window drag and no other', () => {
    const context = setup()
    const { harness, view, runFrames } = context
    const both = (ay: number, by: number, dragging: boolean) =>
      [
        { type: 'position', id: 'a', position: { x: 0, y: ay }, dragging },
        { type: 'position', id: 'b', position: { x: 400, y: by }, dragging },
      ] as never
    act(() => view.result.current.apply(both(30, 30, true)))
    runFrames()
    expect([...view.result.current.readInteraction().liveNodes!.keys()]).toEqual(['a', 'b'])
    const c = storedNode(context, 'c')
    harness.notifications.mockClear()

    act(() => view.result.current.apply(both(50, 50, false)))

    expect(storedNode(context, 'a').position.y).toBe(50)
    expect(storedNode(context, 'b').position.y).toBe(50)
    expect(storedNode(context, 'c')).toBe(c)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })

  // A window the gesture pushes is the gesture's: it is in the overlay and the release writes it.
  it('writes the windows the gesture pushed, with the dragged one, and no other', () => {
    const [inside, dragged, pushed] = createRowNodes(['inside', 'dragged', 'pushed']).map(sizedNode)
    const nodes = [
      { ...inside, position: { x: 24, y: 24 } },
      { ...dragged, position: { x: 24, y: 700 } },
      { ...pushed, position: { x: 560, y: 24 } },
      { ...sizedNode(createRowNodes(['far'])[0]), position: { x: 4000, y: 4000 } },
    ]
    const space = createSpace('space', { x: 0, y: 0, width: 520, height: 360 }, ['inside'])
    const context = setup(nodes, { spaces: [space] })
    const { view, runFrames, liveIds, harness } = context
    const far = storedNode(context, 'far')

    act(() => view.result.current.apply(drag('dragged', 60, 200)))
    runFrames()

    expect(liveIds()).toEqual(['inside', 'dragged', 'pushed'])
    act(() => view.result.current.apply(drop('dragged', 60, 200)))
    const after = harness.readStoreDocument().nodes
    expect(after.find(node => node.id === 'pushed')?.position.x).toBeGreaterThan(560)
    expect(after.find(node => node.id === 'inside')?.position.y).toBeLessThan(24)
    expect(after.find(node => node.id === 'far')).toBe(far)
  })

  it('writes nothing, and ends the gesture, when the windows end where they began', () => {
    const context = setup()
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()

    act(() => view.result.current.apply(drop('a', 0, 0)))

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes).toBe(nodesBefore)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(context.yOf.shown('a')).toBe(0)
  })

  it('writes nothing for the windows a release names that the store no longer holds', () => {
    const context = setup()
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    act(() => {
      setDocumentNodes(
        harness.workspaceId,
        harness.readStoreDocument().nodes.filter(node => node.id !== 'a'),
      )
    })
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()

    act(() => view.result.current.apply(drop('a', 0, 40)))

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes).toBe(nodesBefore)
    expect(harness.readStoreDocument().nodes.map(node => node.id)).toEqual(['b', 'c'])
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
  })
})

// The release write applies entries to the windows the store holds. An entry of a window that is
// gone, which a late release to an old callback could carry, changes nothing and writes nothing.
describe('the release write', () => {
  it('writes nothing for an entry of a window the store no longer holds', () => {
    const context = setup()
    const { harness, view } = context
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()

    act(() =>
      view.result.current.publishers.commitNodesRelease({
        liveNodes: new Map([['gone', { position: { x: 5, y: 5 }, dragging: false }]]),
        removedIds: new Set(),
        spaceRects: null,
      }),
    )

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes).toBe(nodesBefore)
  })

  it('applies the entry of a window the store holds and leaves the others as they are', () => {
    const context = setup()
    const { harness, view } = context
    const b = storedNode(context, 'b')
    harness.notifications.mockClear()

    act(() =>
      view.result.current.publishers.commitNodesRelease({
        liveNodes: new Map([
          ['a', { position: { x: 5, y: 5 }, dragging: false }],
          ['gone', { position: { x: 9, y: 9 }, dragging: false }],
        ]),
        removedIds: new Set(),
        spaceRects: null,
      }),
    )

    expect(storedNode(context, 'a').position).toEqual({ x: 5, y: 5 })
    expect(storedNode(context, 'b')).toBe(b)
    expect(harness.readStoreDocument().nodes.map(node => node.id)).toEqual(['a', 'b', 'c'])
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })
})

// A remove or select batch that arrives while a drag is live is a release (S6, PR 4). Its write is
// still the one release write: the removal, and the gesture's windows where they are.
describe('a remove batch in the middle of a gesture', () => {
  it('removes the window and lands the dragged one, in one write', () => {
    const context = setup()
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    harness.notifications.mockClear()

    act(() => view.result.current.apply([{ type: 'remove', id: 'c' }] as never))

    expect(harness.readStoreDocument().nodes.map(node => node.id)).toEqual(['a', 'b'])
    expect(storedNode(context, 'a').position.y).toBe(30)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
  })

  it('unlinks the task of a removed agent in the same write', () => {
    const [task, agent] = createRowNodes(['task', 'agent']).map(sizedNode)
    const linkedTask: Node<TerminalNodeData> = {
      ...task,
      data: {
        ...task.data,
        kind: 'task',
        task: {
          requirement: 'r',
          status: 'doing',
          linkedAgentNodeId: 'agent',
          agentSessions: [],
          lastRunAt: null,
          autoGeneratedTitle: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as never,
      },
    }
    const context = setup([linkedTask, agent])
    const { view, runFrames } = context
    act(() => view.result.current.apply(drag('task', 0, 30)))
    runFrames()

    act(() => view.result.current.apply([{ type: 'remove', id: 'agent' }] as never))

    const stored = storedNode(context, 'task')
    expect(stored.data.task?.linkedAgentNodeId).toBeNull()
    expect(stored.data.task?.status).toBe('todo')
    expect(stored.position.y).toBe(30)
  })
})

// A Space-dominant drag (selected nodes and Spaces together) writes the windows and the Space
// frames in one store update, and flushes the persistence only when a frame changed.
describe('the release of a Space-dominant drag', () => {
  const N1 = () => sizedNode({ ...createRowNodes(['n1'])[0], position: { x: 50, y: 50 } })
  const SPACE = () => createSpace('space-1', { x: 0, y: 0, width: 600, height: 400 }, ['n1'])

  function setupDominant() {
    const context = setup([N1()], { spaces: [SPACE()] })
    act(() =>
      context.view.result.current.selection.select({ nodeIds: ['n1'], spaceIds: ['space-1'] }),
    )
    return context
  }

  it('writes the nodes and the Space frames in one notification and flushes once', () => {
    const context = setupDominant()
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('n1', 150, 100)))
    runFrames()
    expect(
      view.result.current.readInteraction().nodeDragFramePreview?.get('space-1'),
    ).toMatchObject({ x: 100, y: 50 })
    harness.notifications.mockClear()
    harness.flush.mockClear()

    act(() => view.result.current.apply(drop('n1', 150, 100)))

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().spaces[0].rect).toMatchObject({ x: 100, y: 50 })
    expect(storedNode(context, 'n1').position).toEqual({ x: 150, y: 100 })
    expect(view.result.current.readInteraction().nodeDragFramePreview).toBeNull()
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
  })

  it('flushes with the nodes and the Spaces both written when it does', () => {
    const context = setupDominant()
    const { harness, view, runFrames } = context
    const atFlush: unknown[] = []
    harness.flush.mockImplementation(() => {
      atFlush.push([
        harness.readStoreDocument().spaces[0].rect,
        harness.readStoreDocument().nodes[0].position,
      ])
    })
    act(() => view.result.current.apply(drag('n1', 150, 100)))
    runFrames()

    act(() => view.result.current.apply(drop('n1', 150, 100)))

    expect(atFlush).toEqual([[expect.objectContaining({ x: 100, y: 50 }), { x: 150, y: 100 }]])
  })

  it('writes and flushes nothing when no frame and no window moved', () => {
    const context = setupDominant()
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('n1', 50, 50)))
    runFrames()
    const before = harness.readStoreDocument()
    harness.notifications.mockClear()
    harness.flush.mockClear()

    act(() => view.result.current.apply(drop('n1', 50, 50)))

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes).toBe(before.nodes)
    expect(harness.readStoreDocument().spaces).toBe(before.spaces)
  })

  it('is not Space-dominant when no Space is selected: the window moves, the frame stays, no flush', () => {
    const context = setup([N1()], { spaces: [SPACE()] })
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('n1', 150, 100)))
    runFrames()
    harness.notifications.mockClear()
    harness.flush.mockClear()

    act(() => view.result.current.apply(drop('n1', 150, 100)))

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().spaces[0].rect).toMatchObject({ x: 0, y: 0 })
  })
})

// Review of PR 5: three ways a release came without the entry it needs.
type N = Node<TerminalNodeData>
const both = (ay: number, by: number, dragging: boolean) =>
  [
    { type: 'position', id: 'a', position: { x: 0, y: ay }, dragging },
    { type: 'position', id: 'b', position: { x: 400, y: by }, dragging },
  ] as never

function fromElsewhere(context: ReturnType<typeof setup>, change: (nodes: N[]) => N[]) {
  act(() => {
    setDocumentNodes(context.harness.workspaceId, change(context.harness.readStoreDocument().nodes))
  })
}
const moveTo = (id: string, x: number, y: number) => (nodes: N[]) =>
  nodes.map(node => (node.id === id ? { ...node, position: { x, y } } : node))

// A select or remove batch that arrives while a drag is live is a release: it ends the session.
// React Flow's drag goes on, and so must the gesture: the rest of it lands at its release.
describe('a release with no position change, in the middle of a drag', () => {
  it('Escape on the focused window (an unselect batch): the rest of the drag still lands', () => {
    const context = setup()
    const { view, runFrames, yOf } = context
    context.grab('a')
    act(() => view.result.current.selection.select({ nodeIds: ['a'], spaceIds: [] }))
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => view.result.current.apply([{ type: 'select', id: 'a', selected: false }] as never))
    // The release ended the gesture, so the flag is down and the next frame begins a session.
    expect(view.result.current.nodeStore.isNodeDraggingRef.current).toBe(false)
    act(() => view.result.current.apply(drag('a', 0, 200)))
    runFrames()
    expect(yOf.shown('a')).toBe(200)
    act(() => view.result.current.apply(drop('a', 0, 200)))

    expect(yOf.stored('a')).toBe(200)
    expect(yOf.shown('a')).toBe(200)
    // On the base the batch in the middle stored `dragging: true` (the release applied the live
    // view's entries with `applyLiveNodes`), and a document node left so made every Worker sync
    // keep all local positions of the workspace until React Flow's own release. The release now
    // writes positions only (S7, PR 3), so none is left.
    expect(
      context.harness.readStoreDocument().nodes.filter(node => node.dragging === true),
    ).toEqual([])
  })

  it('a remove batch of another window: the rest of the drag still lands', () => {
    const context = setup()
    const { view, runFrames, yOf } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => view.result.current.apply([{ type: 'remove', id: 'c' }] as never))
    expect(view.result.current.nodeStore.isNodeDraggingRef.current).toBe(false)
    act(() => view.result.current.apply(drag('a', 0, 60)))
    runFrames()
    expect(view.result.current.nodeDragSession.dragBaselinePositionByIdRef.current).not.toBeNull()
    act(() => view.result.current.apply(drop('a', 0, 60)))

    expect(yOf.stored('a')).toBe(60)
  })

  // React Flow aborts a touch drag when a second finger lands (`touches.length > 1`): no release,
  // and nothing leaves the document, so the abort effect cannot see it. The next tap is a release.
  it('a drag aborted with no release: after the next tap, the next drag lands', () => {
    const context = setup()
    const { view, runFrames, yOf } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => view.result.current.apply([{ type: 'select', id: 'c', selected: true }] as never))
    act(() => view.result.current.apply(drag('b', 400, 300)))
    runFrames()
    act(() => view.result.current.apply(drop('b', 400, 300)))

    expect(yOf.stored('b')).toBe(300)
    expect(yOf.shown('b')).toBe(300)
  })
})

// The windows the release batch names are the gesture's, wherever they end.
describe('a dragged window moved from elsewhere during the drag', () => {
  it('lands where it is released, also at the spot where the drag began', () => {
    const context = setup()
    const { view, runFrames, yOf } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    fromElsewhere(context, moveTo('a', 0, 500))
    expect(yOf.shown('a')).toBe(30)

    act(() => view.result.current.apply(drag('a', 0, 0)))
    runFrames()
    act(() => view.result.current.apply(drop('a', 0, 0)))

    expect(yOf.stored('a')).toBe(0)
    expect(yOf.shown('a')).toBe(0)
  })

  it('keeps a multi-window drag together when a peer was moved from elsewhere', () => {
    const context = setup()
    const { view, runFrames, yOf } = context
    act(() => view.result.current.apply(both(30, 30, true)))
    runFrames()
    fromElsewhere(context, moveTo('b', 400, 900))

    act(() => view.result.current.apply(both(0, 0, true)))
    runFrames()
    act(() => view.result.current.apply(both(0, 0, false)))

    expect(yOf.stored('a')).toBe(0)
    expect(yOf.stored('b')).toBe(0)
  })

  it('still writes nothing when the drag ends where it began and nothing moved it', () => {
    const context = setup()
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()

    act(() => view.result.current.apply(drop('a', 0, 0)))

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes).toBe(nodesBefore)
  })
})

// A window created during the drag has no baseline entry, but its base position is the store's:
// any other position in the frame is the gesture's push (fix C). Before PR 5 the release pushed it.
describe('a window created during the drag where the dragged window is', () => {
  it('is pushed by the release instead of staying under the dropped window', () => {
    const context = setup()
    const { view, runFrames, yOf } = context
    act(() => view.result.current.apply(drag('a', 0, 300)))
    runFrames()
    let created: N | null = null
    act(() => {
      created = view.result.current.nodeStore.createNoteNode({ x: 0, y: 300 })
    })
    const id = (created as N | null)!.id
    act(() => view.result.current.apply(drag('a', 0, 320)))
    runFrames()
    act(() => view.result.current.apply(drop('a', 0, 320)))

    expect(yOf.stored('a')).toBe(320)
    // The note (200 high) no longer overlaps the window dropped at 320 (200 high).
    expect(yOf.stored(id)).toBeGreaterThanOrEqual(520)
  })
})

// The same batches, by their own assertion: the dragged window is stored at its live position and
// no canvas-only field is (on the base it was stored with `dragging: true`).
describe('a select or remove batch in the middle of a drag', () => {
  it.each([
    ['an unselect batch', [{ type: 'select', id: 'c', selected: false }]],
    ['a select batch of another window', [{ type: 'select', id: 'a', selected: true }]],
    ['a remove batch of another window', [{ type: 'remove', id: 'a' }]],
  ])('%s stores the dragged window at its live position and no flag', (_name, batch) => {
    const context = setup()
    const { harness, view, runFrames } = context
    act(() => view.result.current.selection.select({ nodeIds: ['c'], spaceIds: [] }))
    act(() => view.result.current.apply(drag('c', 803, 40)))
    runFrames()

    act(() => view.result.current.apply(batch as never))

    const stored = harness.readStoreDocument().nodes
    expect(stored.find(node => node.id === 'c')?.position).toEqual({ x: 803, y: 40 })
    stored.forEach(node => {
      expect(node.selected, `${node.id}.selected`).toBeUndefined()
      expect(node.dragHandle, `${node.id}.dragHandle`).toBeUndefined()
      expect(node.dragging, `${node.id}.dragging`).toBeUndefined()
    })
  })
})
