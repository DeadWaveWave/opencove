import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createRowNodes } from '../../support/canvasSelectionFixtures'
import { useStoreApi } from '@xyflow/react'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import {
  drag,
  drop,
  ROW,
  setupNodeDrag as setup,
  sizedNode,
  useDragUnderTest,
} from '../../support/nodeDragHarness'

// S7, PR 3: React Flow's change path writes the document only for what a batch really does to it:
// a removal, and a settled move. A select batch publishes the selection to the canvas store and
// writes no document, and no batch, frame or release puts a canvas-only field (`selected`,
// `dragHandle`, `dragging`) into it. Where a window is shown as selected or dragging is the view's
// business (`decorateFlowNodes`, `applyLiveNodes`).

afterEach(() => {
  vi.restoreAllMocks()
})

const storedNode = (context: ReturnType<typeof setup>, id: string) =>
  context.harness.readStoreDocument().nodes.find(node => node.id === id)!

const CANVAS_ONLY_FIELDS = ['selected', 'dragHandle', 'dragging'] as const

function expectNoCanvasOnlyField(node: Node<TerminalNodeData>): void {
  for (const field of CANVAS_ONLY_FIELDS) {
    expect(node[field], `${node.id}.${field}`).toBeUndefined()
  }
}

describe('a select batch', () => {
  it('makes no document notification and no flush, and still selects', () => {
    const context = setup()
    const { harness, view } = context
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()

    act(() => view.result.current.apply([{ type: 'select', id: 'c', selected: true }] as never))

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes).toBe(nodesBefore)
    expect(view.result.current.canvasState.selectedNodeIds).toEqual(['c'])
    const shown = view.result.current.canvasState.flowNodes
    expect(shown.filter(node => node.selected).map(node => node.id)).toEqual(['c'])
  })

  it('moves the selection from one window to another with no document write', () => {
    const context = setup()
    const { harness, view } = context
    act(() => view.result.current.apply([{ type: 'select', id: 'a', selected: true }] as never))
    harness.notifications.mockClear()

    act(() =>
      view.result.current.apply([
        { type: 'select', id: 'a', selected: false },
        { type: 'select', id: 'b', selected: true },
      ] as never),
    )

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(view.result.current.canvasState.selectedNodeIds).toEqual(['b'])
  })

  it('keeps the view object of a window whose flags did not change', () => {
    const context = setup()
    const { view } = context
    act(() => view.result.current.apply([{ type: 'select', id: 'a', selected: true }] as never))
    const before = view.result.current.canvasState.flowNodes

    act(() => view.result.current.apply([{ type: 'select', id: 'c', selected: true }] as never))

    const after = view.result.current.canvasState.flowNodes
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).not.toBe(before[2])
  })
})

describe('a settled move without a drag', () => {
  it('writes the normalized position and no canvas-only field', () => {
    const context = setup()
    const { harness, view } = context
    harness.notifications.mockClear()
    const data = storedNode(context, 'a').data

    act(() => view.result.current.apply(drop('a', 400, 0)))

    // `b` stands where `a` was dropped, so the position is the one the node store resolves.
    const resolved = view.result.current.nodeStore.normalizePosition(
      'a',
      { x: 400, y: 0 },
      { width: data.width, height: data.height },
    )
    expect(resolved).not.toEqual({ x: 400, y: 0 })
    expect(storedNode(context, 'a').position).toEqual(resolved)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    ROW().forEach((_, index) => expectNoCanvasOnlyField(harness.readStoreDocument().nodes[index]))
  })

  it('writes no dragging flag for a window of a selection either', () => {
    const context = setup()
    const { harness, view } = context
    act(() => view.result.current.selection.select({ nodeIds: ['c'], spaceIds: [] }))
    harness.notifications.mockClear()

    act(() => view.result.current.apply(drop('c', 3000, 3000)))

    expect(storedNode(context, 'c').position).toEqual({ x: 3000, y: 3000 })
    expectNoCanvasOnlyField(storedNode(context, 'c'))
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })

  it('keeps the stored object of a window the batch did not move', () => {
    const context = setup()
    const { view } = context
    const untouched = { a: storedNode(context, 'a'), b: storedNode(context, 'b') }

    act(() => view.result.current.apply(drop('c', 3000, 3000)))

    expect(storedNode(context, 'a')).toBe(untouched.a)
    expect(storedNode(context, 'b')).toBe(untouched.b)
  })
})

describe('a drag and its release', () => {
  it('hold no canvas-only field in the document at any frame, and write none at the release', () => {
    const context = setup()
    const { harness, view, runFrames } = context
    act(() => view.result.current.apply(drag('c', 803, 40)))
    runFrames()
    act(() => view.result.current.apply(drag('c', 810, 60)))
    runFrames()
    // The gesture's windows are in the overlay, flagged there, and not in the document.
    expect(view.result.current.readInteraction().liveNodes?.get('c')?.dragging).toBe(true)
    harness.readStoreDocument().nodes.forEach(expectNoCanvasOnlyField)

    act(() => view.result.current.apply(drop('c', 812, 70)))

    expect(storedNode(context, 'c').position).toEqual({ x: 812, y: 70 })
    harness.readStoreDocument().nodes.forEach(expectNoCanvasOnlyField)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
  })

  it('release a selected window with no selected or dragging flag in the document', () => {
    const context = setup()
    const { harness, view, runFrames } = context
    act(() => view.result.current.selection.select({ nodeIds: ['a'], spaceIds: [] }))
    act(() => view.result.current.apply(drag('a', 0, 30)))
    runFrames()

    act(() => view.result.current.apply(drop('a', 0, 40)))

    expect(storedNode(context, 'a').position.y).toBe(40)
    harness.readStoreDocument().nodes.forEach(expectNoCanvasOnlyField)
    // The view still shows the window as selected.
    const shown = view.result.current.shown.find(node => node.id === 'a')
    expect(shown?.selected).toBe(true)
  })
})

describe('a remove batch', () => {
  it('is one recipe write that takes the window out and unlinks what pointed at it', () => {
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
    const { harness, view } = context
    harness.notifications.mockClear()

    act(() => view.result.current.apply([{ type: 'remove', id: 'agent' }] as never))

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().nodes.map(node => node.id)).toEqual(['task'])
    const stored = storedNode(context, 'task')
    expect(stored.data.task?.linkedAgentNodeId).toBeNull()
    expect(stored.data.task?.status).toBe('todo')
  })

  it('selects and removes in one batch with one write, and publishes the selection', () => {
    const context = setup()
    const { harness, view } = context
    harness.notifications.mockClear()

    act(() =>
      view.result.current.apply([
        { type: 'select', id: 'c', selected: true },
        { type: 'remove', id: 'a' },
      ] as never),
    )

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().nodes.map(node => node.id)).toEqual(['b', 'c'])
    expect(view.result.current.canvasState.selectedNodeIds).toEqual(['c'])
    harness.readStoreDocument().nodes.forEach(expectNoCanvasOnlyField)
  })
})

describe('a batch that selects, removes and settles a move at once (no drag)', () => {
  it('is one write: the removal, the normalized position, and no flag', () => {
    const context = setup()
    const { harness, view } = context
    harness.notifications.mockClear()

    act(() =>
      view.result.current.apply([
        { type: 'select', id: 'a', selected: true },
        { type: 'remove', id: 'b' },
        { type: 'position', id: 'a', position: { x: 800, y: 0 }, dragging: false },
      ] as never),
    )

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    const stored = harness.readStoreDocument().nodes
    expect(stored.map(node => node.id)).toEqual(['a', 'c'])
    // `c` stands where `a` was dropped, so the stored position is the one the node store resolved.
    expect(stored[0].position).not.toEqual({ x: 800, y: 0 })
    expect(stored[0].position).not.toEqual({ x: 0, y: 0 })
    expect(view.result.current.canvasState.selectedNodeIds).toEqual(['a'])
    stored.forEach(expectNoCanvasOnlyField)
  })
})

function useDragWithFlowStore(context: CanvasNodeStoreContext) {
  return { ...useDragUnderTest(context), flowStore: useStoreApi() }
}

describe('the change path and the render share one view per committed node', () => {
  // The handler's decoration (`useDecorateCommittedNodes`) and the render's (`flowNodes`) share the
  // cache, which holds one view per committed node. They must derive the same flags, or every write
  // gives the selected windows a new view object.
  it('keeps the view object of a selected window across a write in the drag-surface mode', () => {
    const harness = createCanvasDocumentHarness({ nodes: ROW() })
    const view = renderCanvasNodeStore(harness, { extend: useDragWithFlowStore })
    act(() => view.result.current.selection.select({ nodeIds: ['c'], spaceIds: [] }))
    act(() =>
      view.result.current.flowStore.setState({ coveDragSurfaceSelectionMode: true } as never),
    )
    const before = view.result.current.shown.find(node => node.id === 'c')!
    expect(before.dragHandle).toBeUndefined()

    // A settled move of another window: the change path decorates, then the store write renders.
    act(() =>
      view.result.current.apply([
        { type: 'position', id: 'a', position: { x: 1300, y: 400 }, dragging: false },
      ] as never),
    )

    expect(view.result.current.shown.find(node => node.id === 'c')).toBe(before)
  })
})
