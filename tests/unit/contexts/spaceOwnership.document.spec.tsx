import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import {
  commitCanvasDocument,
  readWorkspaceDocument,
  replaceWorkspaceNodes,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasSpaceOwnership } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'
import { renderSpaceOwnershipInDocument } from '../../support/spaceOwnershipHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'

// The drop and the warning of a node drag read the committed document when they run, write the
// nodes and the Spaces of a drop in one store update, and flush once, after the last synchronous
// write of the drop (#702, PR 3).

const A_RECT = { x: 0, y: 0, width: 600, height: 400 }
const C_RECT = { x: 700, y: 0, width: 500, height: 400 }
const REPO = '/tmp/repo'
const OTHER = '/tmp/other'
const DROP_INTO_C = { x: 950, y: 200 }
const NODE_IN_C = { x: 800, y: 100 }

// The nodes carry the initial size that the node store would otherwise add with its first write.
function sized(node: Node<TerminalNodeData>): Node<TerminalNodeData> {
  return { ...node, initialWidth: node.data.width, initialHeight: node.data.height }
}

function note(id: string, x: number, y: number): Node<TerminalNodeData> {
  return sized({ ...createRowNodes([id])[0], position: { x, y } })
}

function terminal(
  id: string,
  x: number,
  y: number,
  directories: { execution: string; expected: string | null },
): Node<TerminalNodeData> {
  return sized({
    ...pixelNode({
      kind: 'terminal',
      sessionId: `${id}-session`,
      executionDirectory: directories.execution,
      expectedDirectory: directories.expected,
    }),
    id,
    position: { x, y },
  })
}

function spaceA(nodeIds = ['n1']): WorkspaceSpaceState {
  return createSpace('space-a', A_RECT, nodeIds)
}

function spaceC(directoryPath = REPO): WorkspaceSpaceState {
  return { ...createSpace('space-c', C_RECT, []), directoryPath }
}

const frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames.length = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(callback)
    return frames.length
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function runFrames() {
  act(() => {
    while (frames.length > 0) {
      frames.shift()?.(0)
    }
  })
}

type View = ReturnType<typeof renderSpaceOwnershipInDocument>
const keepSelection = { clientX: 10, clientY: 10, shiftKey: true } as React.MouseEvent

function startDrag(
  view: View,
  harness: ReturnType<typeof createCanvasDocumentHarness>,
  id: string,
) {
  const node = harness.readStoreDocument().nodes.find(item => item.id === id)!
  act(() => view.result.current.ownership.handleNodeDragStart({ ...keepSelection }, node, [node]))
  return node
}

/** What the release commit of React Flow leaves behind: the node at its dropped position. */
function releaseAt(
  harness: ReturnType<typeof createCanvasDocumentHarness>,
  id: string,
  position: { x: number; y: number },
) {
  act(() => {
    replaceWorkspaceNodes(
      harness.workspaceId,
      harness
        .readStoreDocument()
        .nodes.map(node => (node.id === id ? { ...node, position } : node)),
    )
  })
  return harness.readStoreDocument().nodes.find(item => item.id === id)!
}

function stopAt(view: View, node: Node<TerminalNodeData>, point: { x: number; y: number }) {
  const { ownership } = view.result.current
  act(() =>
    ownership.handleNodeDragStop(
      { clientX: point.x, clientY: point.y, shiftKey: true } as React.MouseEvent,
      node,
      [node],
    ),
  )
}

function setup(
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[] = [spaceA(), spaceC()],
  options: Parameters<typeof renderSpaceOwnershipInDocument>[1] = {},
) {
  const harness = createCanvasDocumentHarness({ nodes, spaces })
  const view = renderSpaceOwnershipInDocument(harness, options)
  return { harness, view }
}

function dropN1IntoC(
  view: View,
  harness: ReturnType<typeof createCanvasDocumentHarness>,
  clear = true,
) {
  startDrag(view, harness, 'n1')
  const dropped = releaseAt(harness, 'n1', NODE_IN_C)
  if (clear) {
    harness.notifications.mockClear()
    harness.flush.mockClear()
  }
  stopAt(view, dropped, DROP_INTO_C)
}

describe('a node drop into a Space', () => {
  it('writes the nodes and the Spaces of the drop in one store update, and both are stored', () => {
    const { harness, view } = setup([note('n1', 50, 60)])

    dropN1IntoC(view, harness)

    const document = harness.readStoreDocument()
    expect(document.spaces.map(space => [space.id, space.nodeIds])).toEqual([
      ['space-a', []],
      ['space-c', ['n1']],
    ])
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(document.nodes[0].position.x).toBeGreaterThanOrEqual(C_RECT.x)
  })

  // The drop changes no ownership and no override: only the projection grows the Space around the
  // member that moved inside it. The Spaces of the write must still carry that growth.
  it('writes the Space that only the projection changes, in the same single update', () => {
    const { harness, view } = setup([note('n1', 50, 60)])
    startDrag(view, harness, 'n1')
    const dropped = releaseAt(harness, 'n1', { x: 380, y: 260 })
    harness.notifications.mockClear()

    stopAt(view, dropped, { x: 450, y: 300 })

    expect(harness.readStoreDocument().spaces[0].rect?.height).toBeGreaterThan(A_RECT.height)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })

  it('flushes once for the drop', () => {
    const { harness, view } = setup([note('n1', 50, 60)])

    dropN1IntoC(view, harness)

    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('writes the expected directory with a second update, flushes once after it, and the selection is a third', () => {
    const { harness, view } = setup(
      [terminal('n1', 50, 60, { execution: REPO, expected: OTHER })],
      [spaceA(), spaceC(REPO)],
    )
    let expectedAtFlush: unknown = 'no flush'
    harness.flush.mockImplementation(() => {
      expectedAtFlush = harness.readStoreDocument().nodes[0].data.expectedDirectory
    })

    dropN1IntoC(view, harness)

    expect(harness.notifications).toHaveBeenCalledTimes(2)
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(expectedAtFlush).toBe(REPO)

    runFrames()
    expect(harness.notifications).toHaveBeenCalledTimes(3)
    expect(harness.readStoreDocument().nodes[0].selected).toBe(true)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('asks the terminals to sync their layout for the drop and not for the directory write', () => {
    const { harness, view } = setup(
      [terminal('n1', 50, 60, { execution: REPO, expected: OTHER })],
      [spaceA(), spaceC(REPO)],
    )
    const onLayoutSync = vi.fn()
    window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, onLayoutSync)
    try {
      dropN1IntoC(view, harness)
      runFrames()
    } finally {
      window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, onLayoutSync)
    }

    expect(onLayoutSync).toHaveBeenCalledTimes(1)
  })

  // The recipe of the drop returns a new node array even when no position moved, as it did on the
  // base, so a drop that changes no content is still one update and one flush.
  it('is one update with the same content, and one flush, for a node that stays where it is', () => {
    const { harness, view } = setup([note('n2', 1416, 816)], [spaceA(), spaceC()], {
      selectedNodeIds: ['n2'],
    })
    startDrag(view, harness, 'n2')
    stopAt(view, harness.readStoreDocument().nodes[0], { x: 1500, y: 900 })
    runFrames()
    startDrag(view, harness, 'n2')
    const before = harness.readStoreDocument()
    harness.notifications.mockClear()
    harness.flush.mockClear()

    stopAt(view, before.nodes[0], { x: 1500, y: 900 })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().nodes).toEqual(before.nodes)
    expect(harness.readStoreDocument().spaces).toEqual(before.spaces)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('writes nothing for dragged nodes that the document does not hold, and flushes once', () => {
    const ghost = note('ghost', 800, 100)
    const { harness, view } = setup([note('n1', 50, 60)], [spaceA(), spaceC()], {
      reactFlowNodes: () => [ghost],
    })
    act(() =>
      view.result.current.ownership.handleNodeDragStart({ ...keepSelection }, ghost, [ghost]),
    )
    const before = harness.readStoreDocument()
    harness.notifications.mockClear()
    harness.flush.mockClear()

    stopAt(view, ghost, DROP_INTO_C)

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes).toBe(before.nodes)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('applies the node changes to the nodes of the write, which carry the canvas fields', () => {
    const { harness, view } = setup([note('n1', 50, 60)])
    // `selected` exists only in the canvas view; the store's node does not hold it.
    act(() => view.result.current.selection.setNodeIds(['n1']))
    expect(harness.readStoreDocument().nodes[0].selected).toBeFalsy()

    dropN1IntoC(view, harness)

    expect(harness.readStoreDocument().nodes[0].selected).toBe(true)
  })
})

function taskDoing(id: string, x: number, y: number): Node<TerminalNodeData> {
  return sized({
    ...pixelNode({
      kind: 'task',
      sessionId: '',
      task: {
        requirement: 'r',
        status: 'doing',
        linkedAgentNodeId: null,
      } as never,
    }),
    id,
    position: { x, y },
  })
}

// Off the 24-unit grid, so that a snap to a Space edge (1 unit) beats a snap to the grid (2 units).
const FREE_AT = { x: 1418, y: 816 }
const FREE_DROP = { x: 1500, y: 900 }

describe('a node drop that fails the transfer check', () => {
  it('reverts the nodes, writes no Spaces, shows the message and does not flush', () => {
    const onShowMessage = vi.fn()
    const { harness, view } = setup([taskDoing('t1', 50, 60)], [spaceA(['t1']), spaceC()], {
      onShowMessage,
    })
    startDrag(view, harness, 't1')
    const dropped = releaseAt(harness, 't1', NODE_IN_C)
    const spacesBefore = harness.readStoreDocument().spaces
    harness.notifications.mockClear()
    harness.flush.mockClear()

    stopAt(view, dropped, DROP_INTO_C)

    expect(onShowMessage).toHaveBeenCalledTimes(1)
    expect(onShowMessage.mock.calls[0][1]).toBe('warning')
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().nodes[0].position).toEqual({ x: 50, y: 60 })
    expect(harness.readStoreDocument().spaces).toEqual(spacesBefore)
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('checks the transfer against the Spaces the store holds when the drop runs', () => {
    const onShowMessage = vi.fn()
    const { harness, view } = setup([taskDoing('t1', FREE_AT.x, FREE_AT.y)], [spaceA([])], {
      onShowMessage,
    })
    startDrag(view, harness, 't1')
    const { ownership } = view.result.current
    const dropped = harness.readStoreDocument().nodes[0]

    act(() => {
      replaceSpacesInStore(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        createSpace('space-late', { x: 1400, y: 800, width: 400, height: 300 }, []),
      ])
      ownership.handleNodeDragStop(
        { clientX: FREE_DROP.x, clientY: FREE_DROP.y, shiftKey: true } as React.MouseEvent,
        dropped,
        [dropped],
      )
    })

    expect(onShowMessage).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().spaces[1].nodeIds).toEqual([])
    expect(harness.flush).not.toHaveBeenCalled()
  })
})

describe('the Space rects of a node drop', () => {
  it('does not commit a rect override when the node is dropped outside every Space', () => {
    const { harness, view } = setup([note('n2', FREE_AT.x, FREE_AT.y)], [spaceA([]), spaceC()])
    startDrag(view, harness, 'n2')
    const node = harness.readStoreDocument().nodes[0]
    const spacesBefore = harness.readStoreDocument().spaces

    act(() =>
      view.result.current.ownership.finalizeDraggedNodeDrop({
        draggedNodeIds: ['n2'],
        draggedNodePositionById: new Map([['n2', FREE_AT]]),
        dragStartNodePositionById: new Map([['n2', FREE_AT]]),
        dropFlowPoint: FREE_DROP,
        fallbackNodes: [node],
        spaceRectOverrideById: new Map([['space-a', { x: 5, y: 5, width: 600, height: 400 }]]),
      }),
    )

    expect(harness.readStoreDocument().spaces).toEqual(spacesBefore)
  })

  it('commits a rect override when the node is dropped into a Space', () => {
    const { harness, view } = setup([note('n2', FREE_AT.x, FREE_AT.y)], [spaceA([]), spaceC()])
    startDrag(view, harness, 'n2')
    const node = harness.readStoreDocument().nodes[0]

    act(() =>
      view.result.current.ownership.finalizeDraggedNodeDrop({
        draggedNodeIds: ['n2'],
        draggedNodePositionById: new Map([['n2', NODE_IN_C]]),
        dragStartNodePositionById: new Map([['n2', FREE_AT]]),
        dropFlowPoint: DROP_INTO_C,
        fallbackNodes: [node],
        spaceRectOverrideById: new Map([['space-a', { x: 5, y: 5, width: 600, height: 400 }]]),
      }),
    )

    const spaces = harness.readStoreDocument().spaces
    expect(spaces[0].rect).toMatchObject({ x: 5, y: 5 })
    expect(spaces[1].nodeIds).toEqual(['n2'])
  })
})

describe('the reads of a node drop', () => {
  it('finds the target Space among the Spaces the store holds when the drop runs', () => {
    const { harness, view } = setup([note('n2', FREE_AT.x, FREE_AT.y)], [spaceA([])])
    startDrag(view, harness, 'n2')
    const { ownership } = view.result.current
    const dropped = harness.readStoreDocument().nodes[0]

    act(() => {
      replaceSpacesInStore(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        createSpace('space-late', { x: 1400, y: 800, width: 400, height: 300 }, []),
      ])
      ownership.handleNodeDragStop(
        { clientX: FREE_DROP.x, clientY: FREE_DROP.y, shiftKey: true } as React.MouseEvent,
        dropped,
        [dropped],
      )
    })

    expect(harness.readStoreDocument().spaces.map(space => [space.id, space.nodeIds])).toEqual([
      ['space-a', []],
      ['space-late', ['n2']],
    ])
  })

  it('snaps against a Space that the store gained since the drop handler was created', () => {
    const { harness, view } = setup([note('n2', FREE_AT.x, FREE_AT.y)], [spaceA([])], {
      magneticSnapping: true,
    })
    startDrag(view, harness, 'n2')
    const { ownership } = view.result.current
    const dropped = harness.readStoreDocument().nodes[0]

    act(() => {
      replaceSpacesInStore(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        // Its left edge is 1 flow unit to the right of the node's left edge, below the node.
        createSpace('space-snap', { x: FREE_AT.x + 1, y: 1100, width: 400, height: 300 }, []),
      ])
      ownership.handleNodeDragStop(
        { clientX: FREE_DROP.x, clientY: FREE_DROP.y, shiftKey: true } as React.MouseEvent,
        dropped,
        [dropped],
      )
    })

    // Without the Space the node would snap to the grid, at 1416.
    expect(harness.readStoreDocument().nodes[0].position.x).toBe(FREE_AT.x + 1)
  })

  it('measures the Spaces that moved during the drag against the rects the store held at its start', () => {
    const member = note('m', 1040, 540)
    const { harness, view } = setup([note('n2', FREE_AT.x, FREE_AT.y), member], [])
    act(() => {
      replaceSpacesInStore(harness.workspaceId, [
        createSpace('space-b', { x: 1000, y: 500, width: 400, height: 300 }, ['m']),
      ])
    })
    startDrag(view, harness, 'n2')
    const { ownership } = view.result.current
    const dropped = harness.readStoreDocument().nodes.find(node => node.id === 'n2')!

    // The Space and its member moved 100 to the right while the other node was dragged.
    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        harness
          .readStoreDocument()
          .nodes.map(node => (node.id === 'm' ? { ...node, position: { x: 1140, y: 540 } } : node)),
      )
      replaceSpacesInStore(harness.workspaceId, [
        createSpace('space-b', { x: 1100, y: 500, width: 400, height: 300 }, ['m']),
      ])
    })
    stopAt(view, dropped, FREE_DROP)

    expect(harness.readStoreDocument().nodes.find(node => node.id === 'm')?.position.x).toBe(1140)
    void ownership
  })

  it('plans the drop from the Spaces and the nodes of the write, not from those it read first', () => {
    const lateNode = note('n-late', 100, 900)
    const lateSpace = createSpace('space-late', { x: 100, y: 1000, width: 300, height: 300 }, [])
    let asked = -1
    const { harness, view } = setup([note('n1', 50, 60)], [spaceA(), spaceC()], {
      // React Flow is asked for a node three times by a drop: for the dropped positions, by the
      // worktree check and, after the decision of the drop has read the document, to measure the
      // dragged nodes. A write lands during the third.
      onReactFlowGetNode: () => {
        asked += 1
        if (asked !== 3) {
          return
        }
        replaceWorkspaceNodes(harness.workspaceId, [...harness.readStoreDocument().nodes, lateNode])
        replaceSpacesInStore(harness.workspaceId, [
          ...harness.readStoreDocument().spaces,
          lateSpace,
        ])
      },
    })
    startDrag(view, harness, 'n1')
    asked = 0
    const dropped = releaseAt(harness, 'n1', NODE_IN_C)

    stopAt(view, dropped, DROP_INTO_C)

    const document = harness.readStoreDocument()
    expect(document.nodes.map(node => node.id)).toEqual(['n1', 'n-late'])
    expect(document.spaces.map(space => space.id)).toEqual(['space-a', 'space-c', 'space-late'])
    expect(document.spaces[1].nodeIds).toEqual(['n1'])
  })
})

describe('the worktree warning of a node drop', () => {
  function mismatch() {
    return setup(
      [terminal('n1', 50, 60, { execution: REPO, expected: REPO })],
      [spaceA(), spaceC(OTHER)],
      { hideWorktreeMismatchDropWarning: false },
    )
  }

  it('asks first, reverts the nodes, writes no Spaces and does not flush', () => {
    const { harness, view } = mismatch()
    startDrag(view, harness, 'n1')
    const dropped = releaseAt(harness, 'n1', NODE_IN_C)
    const spacesBefore = harness.readStoreDocument().spaces
    harness.notifications.mockClear()
    harness.flush.mockClear()

    stopAt(view, dropped, DROP_INTO_C)

    expect(view.result.current.ownership.spaceWorktreeMismatchDropWarning).toMatchObject({
      spaceId: 'space-c',
      terminalCount: 1,
    })
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().nodes[0].position).toEqual({ x: 50, y: 60 })
    expect(harness.readStoreDocument().spaces).toEqual(spacesBefore)
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('continuing applies the drop and flushes once', () => {
    const { harness, view } = mismatch()
    startDrag(view, harness, 'n1')
    const dropped = releaseAt(harness, 'n1', NODE_IN_C)
    stopAt(view, dropped, DROP_INTO_C)
    runFrames()
    harness.flush.mockClear()
    // The revert put the node back; the pending drop carries the dropped positions.
    act(() => view.result.current.ownership.continueSpaceWorktreeMismatchDropWarning())

    expect(harness.readStoreDocument().spaces[1].nodeIds).toEqual(['n1'])
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('reads the target Space of the override branch from the store', () => {
    const { harness, view } = mismatch()
    startDrag(view, harness, 'n1')
    const { ownership } = view.result.current
    const node = harness.readStoreDocument().nodes[0]

    act(() => {
      replaceSpacesInStore(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        {
          ...createSpace('space-late', { x: 0, y: 0, width: 10, height: 10 }, []),
          directoryPath: OTHER,
        },
      ])
      ownership.finalizeDraggedNodeDrop({
        draggedNodeIds: ['n1'],
        draggedNodePositionById: new Map([['n1', { x: 1500, y: 800 }]]),
        dragStartNodePositionById: new Map([['n1', { x: 50, y: 60 }]]),
        dropFlowPoint: { x: 1550, y: 850 },
        fallbackNodes: [node],
        spaceRectOverrideById: new Map([
          ['space-late', { x: 1400, y: 700, width: 400, height: 300 }],
        ]),
      })
    })

    expect(view.result.current.ownership.spaceWorktreeMismatchDropWarning?.spaceId).toBe(
      'space-late',
    )
  })

  it('reads the target Space of the plain branch from the store', () => {
    const { harness, view } = mismatch()
    startDrag(view, harness, 'n1')
    const { ownership } = view.result.current
    const node = releaseAt(harness, 'n1', FREE_AT)

    act(() => {
      replaceSpacesInStore(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        {
          ...createSpace('space-late', { x: 1400, y: 800, width: 400, height: 300 }, []),
          directoryPath: OTHER,
        },
      ])
      ownership.handleNodeDragStop(
        { clientX: FREE_DROP.x, clientY: FREE_DROP.y, shiftKey: true } as React.MouseEvent,
        node,
        [node],
      )
    })

    expect(view.result.current.ownership.spaceWorktreeMismatchDropWarning?.spaceId).toBe(
      'space-late',
    )
  })
})

describe('a node drag that pushes a Space frame', () => {
  it('a release with no captured Space selection: the stop handler of the same call drops into the pushed rect', () => {
    const { harness, view } = setup([note('n1', 50, 50), note('n2', 1416, 816)], [spaceA(['n1'])])
    act(() => view.result.current.selection.setSpaceIds(['space-a']))
    const { nodeDragSession, ownership } = view.result.current
    const n1 = harness.readStoreDocument().nodes[0]
    const n2 = harness.readStoreDocument().nodes[1]
    act(() => nodeDragSession.beginNodeDragSession([n1, n2]))
    act(() => {
      nodeDragSession.projectNodeDrag({
        currentNodes: [n1, n2],
        draggedNodeIds: ['n1'],
        desiredDraggedPositionById: new Map([['n1', { x: 150, y: 100 }]]),
        anchorNodeId: 'n1',
        anchorIsSelected: true,
      })
    })

    act(() => {
      nodeDragSession.endNodeDragSession()
      ownership.handleNodeDragStop(
        { clientX: 650, clientY: 100, shiftKey: true } as React.MouseEvent,
        n2,
        [n2],
      )
    })

    // (650, 100) is outside the rect of the base (it ends at x = 600) and inside the pushed one.
    expect(harness.readStoreDocument().spaces[0].nodeIds).toContain('n2')
  })

  // The order React Flow produces: the start handler captures the selected Spaces, the release
  // writes the pushed frame, and the stop handler of the same call sees the copy and leaves early.
  it('a release with a captured Space selection writes the frame once and the stop handler writes nothing', () => {
    const { harness, view } = setup([note('n1', 50, 50), note('n2', 1416, 816)], [spaceA(['n1'])])
    act(() => view.result.current.selection.select({ nodeIds: ['n1'], spaceIds: ['space-a'] }))
    const nodes = harness.readStoreDocument().nodes
    const n1 = nodes[0]
    const { nodeDragSession, ownership } = view.result.current
    act(() => ownership.handleNodeDragStart({ ...keepSelection }, { ...n1, selected: true }, [n1]))
    expect(nodeDragSession.getDragStartSpaceSelection()).toEqual(['space-a'])
    act(() => nodeDragSession.beginNodeDragSession(nodes))
    act(() => {
      nodeDragSession.projectNodeDrag({
        currentNodes: nodes,
        draggedNodeIds: ['n1'],
        desiredDraggedPositionById: new Map([['n1', { x: 150, y: 100 }]]),
        anchorNodeId: 'n1',
        anchorIsSelected: true,
      })
    })
    harness.notifications.mockClear()
    harness.flush.mockClear()
    const before = harness.readStoreDocument()

    act(() => {
      nodeDragSession.endNodeDragSession()
      ownership.handleNodeDragStop(
        { clientX: 200, clientY: 150, shiftKey: true } as React.MouseEvent,
        n1,
        [n1],
      )
    })

    const after = harness.readStoreDocument()
    expect(after.spaces[0].rect).toMatchObject({ x: 100, y: 50 })
    expect(after.spaces[0].nodeIds).toEqual(before.spaces[0].nodeIds)
    expect(after.nodes).toBe(before.nodes)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(nodeDragSession.getDragStartSpaceSelection()).toBeNull()
  })
})

describe('the workspace of a node drop', () => {
  it('reads the workspace of the render that created the handler', () => {
    createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      nodes: [],
      spaces: [
        {
          ...createSpace('space-of-a', { x: 0, y: 0, width: 600, height: 400 }, []),
          directoryPath: OTHER,
        },
      ],
    })
    const stateA = useAppStore.getState().workspaces[0]
    useAppStore.setState({
      workspaces: [
        stateA,
        {
          ...stateA,
          id: 'workspace-b',
          spaces: [
            {
              ...createSpace('space-of-b', { x: 0, y: 0, width: 600, height: 400 }, []),
              directoryPath: OTHER,
            },
          ],
        },
      ],
    })
    let current = 'workspace-a'
    const guest = terminal('g', 100, 100, { execution: REPO, expected: REPO })
    const view = renderInCanvasDocument(
      () => {
        const reactFlow = {
          screenToFlowPosition: (point: { x: number; y: number }) => point,
          flowToScreenPosition: (point: { x: number; y: number }) => point,
          getNodes: () => [guest],
          getNode: () => guest,
        } as never
        return useWorkspaceCanvasSpaceOwnership({
          workspaceId: current,
          workspacePath: REPO,
          reactFlow,
          nodeDragSession: {
            captureDragStartSpaceSelection: () => undefined,
            getDragStartSpaceSelection: () => null,
            clearDragStartSpaceSelection: () => undefined,
          },
          exclusiveNodeDragAnchorIdRef: { current: null },
          setNodes: vi.fn(),
          updateCanvasDocument: vi.fn(),
          hideWorktreeMismatchDropWarning: false,
        })
      },
      { workspaceId: () => current },
    )
    const handlerOfA = view.result.current.handleNodeDragStop
    current = 'workspace-b'
    view.rerender()
    const event = { clientX: 100, clientY: 100, shiftKey: true } as React.MouseEvent

    act(() => view.result.current.handleNodeDragStop(event, guest, [guest]))
    expect(view.result.current.spaceWorktreeMismatchDropWarning?.spaceId).toBe('space-of-b')

    act(() => view.result.current.cancelSpaceWorktreeMismatchDropWarning())
    act(() => handlerOfA(event, guest, [guest]))
    expect(view.result.current.spaceWorktreeMismatchDropWarning?.spaceId).toBe('space-of-a')
  })

  // Both workspaces hold a Space at the same place. The drop of a task that is doing work must be
  // refused in B, which only the reader of the render that shows B can tell: A's Spaces do not
  // hold the node and show no ownership change.
  it('drops in the workspace of the render that created the handler, and leaves the other alone', () => {
    const task = taskDoing('t1', 50, 60)
    createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      nodes: [task],
      spaces: [{ ...createSpace('space-of-a', C_RECT, []), directoryPath: REPO }],
    })
    const stateA = useAppStore.getState().workspaces[0]
    useAppStore.setState({
      workspaces: [
        stateA,
        {
          ...stateA,
          id: 'workspace-b',
          spaces: [{ ...createSpace('space-of-b', C_RECT, []), directoryPath: REPO }],
        },
      ],
    })
    let current = 'workspace-a'
    const onShowMessage = vi.fn()
    const view = renderInCanvasDocument(
      () => {
        const workspaceId = current
        const nodesOf = () => readWorkspaceDocument(workspaceId)?.nodes ?? []
        const reactFlow = {
          screenToFlowPosition: (point: { x: number; y: number }) => point,
          flowToScreenPosition: (point: { x: number; y: number }) => point,
          getNodes: nodesOf,
          getNode: (id: string) => nodesOf().find(node => node.id === id),
        } as never
        return useWorkspaceCanvasSpaceOwnership({
          workspaceId,
          workspacePath: REPO,
          reactFlow,
          nodeDragSession: {
            captureDragStartSpaceSelection: () => undefined,
            getDragStartSpaceSelection: () => null,
            clearDragStartSpaceSelection: () => undefined,
          },
          exclusiveNodeDragAnchorIdRef: { current: null },
          setNodes: (updater, options) =>
            commitCanvasDocument(
              workspaceId,
              document => ({ ...document, nodes: updater(document.nodes) }),
              options,
            ),
          updateCanvasDocument: (recipe, options) =>
            commitCanvasDocument(
              workspaceId,
              document => ({
                ...document,
                ...recipe({ nodes: document.nodes, spaces: document.spaces }),
              }),
              options,
            ),
          onShowMessage,
          hideWorktreeMismatchDropWarning: true,
        })
      },
      { workspaceId: () => current },
    )
    current = 'workspace-b'
    view.rerender()
    const documentOfA = readWorkspaceDocument('workspace-a')
    const handlers = view.result.current
    act(() => handlers.handleNodeDragStart({ ...keepSelection }, task, [task]))
    act(() => {
      replaceWorkspaceNodes('workspace-b', [{ ...task, position: NODE_IN_C }])
    })
    const dropped = readWorkspaceDocument('workspace-b')!.nodes[0]

    act(() =>
      handlers.handleNodeDragStop(
        { clientX: DROP_INTO_C.x, clientY: DROP_INTO_C.y, shiftKey: true } as React.MouseEvent,
        dropped,
        [dropped],
      ),
    )

    expect(onShowMessage).toHaveBeenCalledTimes(1)
    expect(readWorkspaceDocument('workspace-b')!.nodes[0].position).toEqual({ x: 50, y: 60 })
    expect(readWorkspaceDocument('workspace-b')!.spaces[0].nodeIds).toEqual([])
    expect(readWorkspaceDocument('workspace-a')!.nodes).toBe(documentOfA!.nodes)
    expect(readWorkspaceDocument('workspace-a')!.spaces).toBe(documentOfA!.spaces)
  })
})
