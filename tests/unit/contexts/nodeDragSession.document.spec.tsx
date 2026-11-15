import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasNodeDragSession } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import { useCanvasSelectionCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import {
  readWorkspaceDocument,
  replaceWorkspaceSpaces,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  renderInCanvasDocument,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'

// The node drag session reads the committed Spaces when a frame, the start or the release runs, and
// writes the Spaces of a released Space frame through `updateSpaces` (#702, PR 3).

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands')
      >()
    return { ...actual, readWorkspaceDocument: vi.fn(actual.readWorkspaceDocument) }
  },
)

const setSnapGuides = vi.fn()

function useSessionUnderTest({ workspaceId }: CanvasNodeStoreContext) {
  return {
    session: useWorkspaceCanvasNodeDragSession({
      workspaceId,
      magneticSnappingEnabledRef: { current: false },
      setSnapGuides,
    }),
    selection: useCanvasSelectionCommands(),
  }
}

const A_RECT = { x: 0, y: 0, width: 600, height: 400 }

function sized(node: Node<TerminalNodeData>): Node<TerminalNodeData> {
  return { ...node, initialWidth: node.data.width, initialHeight: node.data.height }
}

function noteAt(id: string, x: number, y: number): Node<TerminalNodeData> {
  return sized({ ...createRowNodes([id])[0], position: { x, y } })
}

function frameOf(
  session: ReturnType<typeof useSessionUnderTest>['session'],
  nodes: Node<TerminalNodeData>[],
  dragged: string,
  to: { x: number; y: number },
  anchorIsSelected = false,
) {
  return session.projectNodeDrag({
    currentNodes: nodes,
    draggedNodeIds: [dragged],
    desiredDraggedPositionById: new Map([[dragged, to]]),
    dropFlowPoint: { x: to.x + 150, y: to.y + 100 },
    anchorNodeId: dragged,
    anchorIsSelected,
  })
}

describe('node drag session frames', () => {
  // A node dragged into a Space makes its frame grow: the preview exists only when the frame
  // knows the Space.
  it('projects an ordinary frame against a Space that a write added since the drag began', () => {
    const static1 = noteAt('static', 24, 24)
    const drag = noteAt('drag', 24, 480)
    const harness = createCanvasDocumentHarness({ nodes: [static1, drag], spaces: [] })
    const view = renderCanvasNodeStore(harness, { extend: useSessionUnderTest })
    const { session } = view.result.current
    act(() => session.beginNodeDragSession([static1, drag]))

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        createSpace('space', { x: 0, y: 0, width: 520, height: 360 }, ['static']),
      ])
      frameOf(session, [static1, drag], 'drag', { x: 24, y: 24 })
    })

    expect(view.result.current.session.nodeSpaceFramePreview?.get('space')?.height).toBeGreaterThan(
      360,
    )
  })

  it('projects a Space-dominant frame from the Spaces the store holds when the frame runs', () => {
    const n1 = noteAt('n1', 50, 50)
    const harness = createCanvasDocumentHarness({
      nodes: [n1],
      spaces: [createSpace('space-1', A_RECT, ['n1'])],
    })
    const view = renderCanvasNodeStore(harness, { extend: useSessionUnderTest })
    act(() => view.result.current.selection.setSpaceIds(['space-1']))
    const { session } = view.result.current
    act(() => session.captureDragStartSpaceSelection())
    act(() => session.beginNodeDragSession([n1]))

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        createSpace('space-late', { x: 700, y: 0, width: 300, height: 400 }, []),
      ])
      frameOf(session, [n1], 'n1', { x: 250, y: 50 }, true)
    })

    // The moved Space runs into the late one and pushes it; the preview names both.
    expect([...(view.result.current.session.nodeSpaceFramePreview?.keys() ?? [])].sort()).toEqual([
      'space-1',
      'space-late',
    ])
  })

  it('starts a Space-dominant drag from the rects the store holds when it begins', () => {
    const n1 = noteAt('n1', 50, 50)
    const harness = createCanvasDocumentHarness({ nodes: [n1], spaces: [] })
    const view = renderCanvasNodeStore(harness, { extend: useSessionUnderTest })
    const { session } = view.result.current

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [createSpace('space-1', A_RECT, ['n1'])])
      view.result.current.selection.setSpaceIds(['space-1'])
      session.captureDragStartSpaceSelection()
      session.beginNodeDragSession([n1])
    })
    act(() => {
      frameOf(session, [n1], 'n1', { x: 150, y: 100 }, true)
    })

    expect(view.result.current.session.nodeSpaceFramePreview?.get('space-1')).toMatchObject({
      x: 100,
      y: 50,
    })
  })

  it.each([
    ['an ordinary frame', false],
    ['a Space-dominant frame', true],
  ])('reads the document twice for %s', (_name, dominant) => {
    const n1 = noteAt('n1', 50, 50)
    const harness = createCanvasDocumentHarness({
      nodes: [n1],
      spaces: [createSpace('space-1', A_RECT, ['n1'])],
    })
    const view = renderCanvasNodeStore(harness, { extend: useSessionUnderTest })
    if (dominant) {
      act(() => view.result.current.selection.setSpaceIds(['space-1']))
    }
    const { session } = view.result.current
    act(() => session.captureDragStartSpaceSelection())
    act(() => session.beginNodeDragSession([n1]))
    vi.mocked(readWorkspaceDocument).mockClear()

    act(() => {
      frameOf(session, [n1], 'n1', { x: 150, y: 100 }, dominant)
    })

    expect(readWorkspaceDocument).toHaveBeenCalledTimes(2)
  })

  it('reads the workspace of the render that created the callbacks', () => {
    const n1 = noteAt('n1', 50, 50)
    createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      nodes: [n1, noteAt('n2', 24, 480)],
      spaces: [createSpace('space', { x: 0, y: 0, width: 520, height: 360 }, ['n1'])],
    })
    const stateA = useAppStore.getState().workspaces[0]
    useAppStore.setState({
      workspaces: [stateA, { ...stateA, id: 'workspace-b', spaces: [] }],
    })
    let current = 'workspace-a'
    const view = renderInCanvasDocument(
      () => {
        return useWorkspaceCanvasNodeDragSession({
          workspaceId: current,
          magneticSnappingEnabledRef: { current: false },
          setSnapGuides,
        })
      },
      { workspaceId: () => current },
    )
    const sessionOfA = view.result.current
    current = 'workspace-b'
    view.rerender()
    const nodes = stateA.nodes

    act(() => {
      view.result.current.beginNodeDragSession(nodes)
      frameOf(view.result.current as never, nodes, 'n2', { x: 24, y: 24 })
    })
    expect(view.result.current.nodeSpaceFramePreview).toBeNull()

    act(() => {
      sessionOfA.beginNodeDragSession(nodes)
      frameOf(sessionOfA as never, nodes, 'n2', { x: 24, y: 24 })
    })
    expect(view.result.current.nodeSpaceFramePreview?.get('space')).toBeDefined()
  })
})

describe('releasing a node drag', () => {
  function setupDominant(spaces = [createSpace('space-1', A_RECT, ['n1'])]) {
    const n1 = noteAt('n1', 50, 50)
    const harness = createCanvasDocumentHarness({ nodes: [n1], spaces })
    const view = renderCanvasNodeStore(harness, { extend: useSessionUnderTest })
    act(() => view.result.current.selection.setSpaceIds(['space-1']))
    const { session } = view.result.current
    act(() => session.captureDragStartSpaceSelection())
    act(() => session.beginNodeDragSession([n1]))
    return { harness, view, session, n1 }
  }

  it('writes the pushed frame once and flushes once', () => {
    const { harness, session, n1 } = setupDominant()
    act(() => {
      frameOf(session, [n1], 'n1', { x: 150, y: 100 }, true)
    })
    harness.notifications.mockClear()
    harness.flush.mockClear()

    act(() => session.endNodeDragSession())

    expect(harness.readStoreDocument().spaces[0].rect).toMatchObject({ x: 100, y: 50 })
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('writes and flushes nothing when the preview holds the rects the Spaces have', () => {
    const { harness, session, n1 } = setupDominant()
    act(() => {
      frameOf(session, [n1], 'n1', { x: 50, y: 50 }, true)
    })
    harness.notifications.mockClear()
    harness.flush.mockClear()

    act(() => session.endNodeDragSession())

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('writes and flushes nothing without a committable preview', () => {
    const { harness, session, n1 } = setupDominant()
    act(() => {
      frameOf(session, [n1], 'n1', { x: 150, y: 100 }, false)
    })
    harness.notifications.mockClear()
    harness.flush.mockClear()

    act(() => session.endNodeDragSession())

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('keeps the Spaces a write added between the last frame and the release', () => {
    const { harness, session, n1 } = setupDominant()
    act(() => {
      frameOf(session, [n1], 'n1', { x: 150, y: 100 }, true)
    })

    act(() => {
      replaceWorkspaceSpaces(harness.workspaceId, [
        ...harness.readStoreDocument().spaces,
        createSpace('space-late', { x: 2000, y: 2000, width: 100, height: 100 }, []),
      ])
      session.endNodeDragSession()
    })

    expect(harness.readStoreDocument().spaces.map(space => space.id)).toEqual([
      'space-1',
      'space-late',
    ])
    expect(harness.readStoreDocument().spaces[0].rect).toMatchObject({ x: 100, y: 50 })
  })
})
