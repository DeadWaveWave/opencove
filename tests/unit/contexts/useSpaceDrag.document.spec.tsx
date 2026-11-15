import { act, fireEvent } from '@testing-library/react'
import type * as React from 'react'
import { useReactFlow, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasSpaceDrag } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag'
import type { UseWorkspaceCanvasNodesStoreResult } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.types'
import { useCanvasSelectionCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { useCanvasCollapseStore } from '../../../src/contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import {
  commitCanvasDocument,
  replaceWorkspaceNodes,
  replaceWorkspaceSpaces,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  renderInCanvasDocument,
  type CanvasDocumentHarness,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'

type SetNodes = UseWorkspaceCanvasNodesStoreResult['setNodes']
type UpdateCanvasDocument = UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']

const setSnapGuides = vi.fn()
const magneticSnappingEnabledRef = { current: false }

beforeEach(() => {
  vi.useFakeTimers()
  setSnapGuides.mockClear()
  magneticSnappingEnabledRef.current = false
})

afterEach(() => {
  vi.useRealTimers()
  useCanvasCollapseStore.setState({ workspaces: {} })
})

const SPACE_A_RECT = { x: 0, y: 0, width: 600, height: 400 }
const SPACE_C_RECT = { x: 700, y: 0, width: 500, height: 400 }

function nodeAt(id: string, x: number, y: number): Node<TerminalNodeData> {
  return { ...createRowNodes([id])[0], position: { x, y } }
}

function spaceA(nodeIds = ['n1']) {
  return createSpace('space-a', SPACE_A_RECT, nodeIds)
}

function spaceC() {
  return createSpace('space-c', SPACE_C_RECT, [])
}

function useDragUnderTest({ workspaceId, nodeStore }: CanvasNodeStoreContext) {
  const flow = useReactFlow<Node<TerminalNodeData>>()
  return {
    drag: useWorkspaceCanvasSpaceDrag({
      workspaceId,
      reactFlow: { ...flow, screenToFlowPosition: point => point, getZoom: () => 1 },
      setNodes: nodeStore.setNodes,
      updateCanvasDocument: nodeStore.updateCanvasDocument,
      magneticSnappingEnabledRef,
      setSnapGuides,
    }),
    selection: useCanvasSelectionCommands(),
  }
}

type DragView = { result: { current: { drag: ReturnType<typeof useWorkspaceCanvasSpaceDrag> } } }

function renderDrag(harness: CanvasDocumentHarness) {
  return renderCanvasNodeStore(harness, { extend: useDragUnderTest })
}

function press(view: DragView, spaceId: string, point: { x: number; y: number }, shiftKey = false) {
  act(() =>
    view.result.current.drag.handleSpaceDragHandlePointerDown(
      {
        button: 0,
        shiftKey,
        clientX: point.x,
        clientY: point.y,
        pointerId: 7,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.PointerEvent<HTMLDivElement>,
      spaceId,
    ),
  )
}

function dragTo(point: { x: number; y: number }) {
  act(() => {
    fireEvent.pointerMove(window, { pointerId: 7, clientX: point.x, clientY: point.y, buttons: 1 })
    vi.advanceTimersByTime(20)
  })
}

function release(point: { x: number; y: number }) {
  act(() => {
    fireEvent.pointerUp(window, { pointerId: 7, clientX: point.x, clientY: point.y })
  })
}

const INSIDE_A = { x: 300, y: 200 }

describe('useWorkspaceCanvasSpaceDrag reads the committed document', () => {
  describe('at pointer down', () => {
    it('starts a drag on a Space that a write added in the same act', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)

      act(() => {
        replaceWorkspaceSpaces(harness.workspaceId, [
          ...harness.readStoreDocument().spaces,
          spaceC(),
        ])
      })
      press(view, 'space-c', { x: 900, y: 200 })

      expect(view.result.current.drag.spaceFramePreview?.get('space-c')).toEqual(SPACE_C_RECT)
    })

    it('carries a node that a write added to the Space in the same act', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)

      act(() => {
        replaceWorkspaceNodes(harness.workspaceId, [nodeAt('n1', 50, 60), nodeAt('n2', 300, 150)])
        replaceWorkspaceSpaces(harness.workspaceId, [spaceA(['n1', 'n2'])])
      })
      press(view, 'space-a', INSIDE_A)
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const positions = harness.readStoreDocument().nodes.map(node => [node.id, node.position.x])
      expect(positions).toEqual([
        ['n1', 150],
        ['n2', 400],
      ])
    })

    it('measures a resize against the nodes the store holds', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      const node = createRowNodes(['n1'])[0]

      // The node ends at x = 450 + width: a resize of the right edge cannot go below it.
      act(() => {
        replaceWorkspaceNodes(harness.workspaceId, [nodeAt('n1', 450, 60)])
      })
      press(view, 'space-a', { x: 599, y: 200 })
      release({ x: 100, y: 200 })

      const rect = harness.readStoreDocument().spaces[0].rect
      expect(rect?.width).toBeGreaterThanOrEqual(450 + (node.data.width ?? 0))
    })
  })

  describe('per frame', () => {
    it('commits the nodes and no Spaces, and does not flush', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA(), spaceC()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)
      const spacesBefore = harness.readStoreDocument().spaces
      harness.notifications.mockClear()

      dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

      const document = harness.readStoreDocument()
      expect(document.nodes[0].position).toEqual({ x: 90, y: 60 })
      expect(document.spaces).toEqual(spacesBefore)
      expect(harness.notifications).toHaveBeenCalledTimes(1)
      expect(harness.flush).not.toHaveBeenCalled()
      expect(view.result.current.drag.spaceFramePreview?.get('space-a')).toMatchObject({ x: 40 })
    })

    it('projects from the Spaces the store holds when the frame runs', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      act(() => {
        replaceWorkspaceSpaces(harness.workspaceId, [
          ...harness.readStoreDocument().spaces,
          spaceC(),
        ])
      })
      dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

      expect([...(view.result.current.drag.spaceFramePreview?.keys() ?? [])].sort()).toEqual([
        'space-a',
        'space-c',
      ])
    })

    it('moves the nodes the store holds, not the ones React Flow holds', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

      expect(harness.readStoreDocument().nodes[0].position.x).toBe(90)
    })
  })

  describe('at pointer up', () => {
    it('writes nodes and Spaces in one store update and flushes once', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)
      harness.notifications.mockClear()
      harness.flush.mockClear()

      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const document = harness.readStoreDocument()
      expect(harness.notifications).toHaveBeenCalledTimes(1)
      expect(harness.flush).toHaveBeenCalledTimes(1)
      expect(document.spaces[0].rect).toMatchObject({ x: 100, y: 0 })
      expect(document.nodes[0].position).toEqual({ x: 150, y: 60 })
      expect(view.result.current.drag.spaceFramePreview).toBeNull()
    })

    it('writes the Spaces once, and flushes once, after frames committed the nodes', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)
      dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
      harness.notifications.mockClear()
      harness.flush.mockClear()

      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      expect(harness.notifications).toHaveBeenCalledTimes(1)
      expect(harness.flush).toHaveBeenCalledTimes(1)
      expect(harness.readStoreDocument().spaces[0].rect).toMatchObject({ x: 100, y: 0 })
      expect(harness.readStoreDocument().nodes[0].position).toEqual({ x: 150, y: 60 })
    })

    it('snaps against a Space that a write added since the pointer went down', () => {
      magneticSnappingEnabledRef.current = true
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      act(() => {
        replaceWorkspaceSpaces(harness.workspaceId, [
          ...harness.readStoreDocument().spaces,
          // Its left edge is 4 flow units from A's left edge after A moves 100 to the right.
          createSpace('space-snap', { x: 104, y: 500, width: 400, height: 400 }, []),
        ])
      })
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      // Without the late Space the Space would stop at x = 100; snapping pulls its left edge to 104 (the grid alone would give 96).
      expect(harness.readStoreDocument().spaces[0].rect?.x).toBe(104)
    })

    it('finalizes from the Spaces the store holds, not the ones read at pointer down', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      act(() => {
        replaceWorkspaceSpaces(harness.workspaceId, [
          ...harness.readStoreDocument().spaces,
          spaceC(),
        ])
      })
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      expect(harness.readStoreDocument().spaces.map(space => space.id)).toEqual([
        'space-a',
        'space-c',
      ])
    })

    it('finalizes from the nodes the store holds, not the ones read at pointer down', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      // A node that the store gained since pointer down is not part of the drag, and is kept.
      act(() => {
        replaceWorkspaceNodes(harness.workspaceId, [
          ...harness.readStoreDocument().nodes,
          nodeAt('n-late', 1500, 700),
        ])
      })
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      expect(harness.readStoreDocument().nodes.map(node => [node.id, node.position.x])).toEqual([
        ['n1', 150],
        ['n-late', 1500],
      ])
    })

    it('applies the node changes to the nodes that carry the canvas fields', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      act(() => view.result.current.selection.select({ nodeIds: ['n1'], spaceIds: ['space-a'] }))
      // `selected` exists only in the canvas view; the store's node does not hold it.
      expect(harness.readStoreDocument().nodes[0].selected).toBeFalsy()
      press(view, 'space-a', INSIDE_A)

      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const [stored] = harness.readStoreDocument().nodes
      expect(stored.position.x).toBe(150)
      expect(stored.selected).toBe(true)
    })

    // On the base a click wrote the nodes (their canvas fields) and then the Spaces, and flushed
    // once; the content did not change. It is now one update and one flush.
    it('changes no content and flushes once for a click', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      act(() => view.result.current.selection.select({ nodeIds: [], spaceIds: ['space-a'] }))
      press(view, 'space-a', INSIDE_A)
      harness.notifications.mockClear()
      harness.flush.mockClear()
      const before = harness.readStoreDocument()

      release({ x: INSIDE_A.x + 2, y: INSIDE_A.y + 1 })

      expect(harness.notifications.mock.calls.length).toBeLessThanOrEqual(1)
      expect(harness.flush).toHaveBeenCalledTimes(1)
      expect(harness.readStoreDocument().nodes.map(node => node.position)).toEqual(
        before.nodes.map(node => node.position),
      )
      expect(harness.readStoreDocument().spaces).toEqual(before.spaces)
    })
  })

  describe('after a workspace switch', () => {
    function renderSwitching() {
      const harness = createCanvasDocumentHarness({
        workspaceId: 'workspace-a',
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      useAppStore.setState(state => ({
        workspaces: [
          ...state.workspaces,
          {
            ...state.workspaces[0],
            id: 'workspace-b',
            nodes: [nodeAt('b1', 50, 60)],
            spaces: [createSpace('space-b', SPACE_A_RECT, ['b1'])],
          },
        ],
      }))
      let shown = 'workspace-a'
      // Stable writers: only the reader (and the workspace id) can change when the user switches.
      const setNodes: SetNodes = (updater, options) => {
        commitCanvasDocument(
          shown,
          document => ({ ...document, nodes: updater(document.nodes) }),
          options,
        )
      }
      const updateCanvasDocument: UpdateCanvasDocument = (recipe, options) => {
        commitCanvasDocument(shown, document => ({ ...document, ...recipe(document) }), options)
      }
      const view = renderInCanvasDocument(
        () => {
          const flow = useReactFlow<Node<TerminalNodeData>>()
          return {
            drag: useWorkspaceCanvasSpaceDrag({
              workspaceId: shown,
              reactFlow: { ...flow, screenToFlowPosition: point => point, getZoom: () => 1 },
              setNodes,
              updateCanvasDocument,
              magneticSnappingEnabledRef,
              setSnapGuides,
            }),
          }
        },
        { workspaceId: () => shown },
      )
      return {
        harness,
        view,
        switchTo: (id: string) => {
          shown = id
          view.rerender()
        },
      }
    }

    it('drags the Space of the workspace shown now, not the one shown before', () => {
      const { harness, view, switchTo } = renderSwitching()
      switchTo('workspace-b')

      press(view, 'space-a', INSIDE_A)
      expect(view.result.current.drag.spaceFramePreview).toBeNull()

      press(view, 'space-b', INSIDE_A)
      dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
      expect([...(view.result.current.drag.spaceFramePreview?.keys() ?? [])]).toEqual(['space-b'])
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const workspaces = useAppStore.getState().workspaces
      const b = workspaces.find(workspace => workspace.id === 'workspace-b')
      const a = workspaces.find(workspace => workspace.id === 'workspace-a')
      expect(b?.spaces[0].rect).toMatchObject({ x: 100 })
      expect(b?.nodes[0].position.x).toBe(150)
      expect(a?.spaces[0].rect).toEqual(SPACE_A_RECT)
      expect(a?.nodes[0].position.x).toBe(50)
      expect(harness.flush).toHaveBeenCalledTimes(1)
    })

    it('snaps against the Spaces of the workspace shown now', () => {
      const { view, switchTo } = renderSwitching()
      useAppStore.setState(state => ({
        workspaces: state.workspaces.map(workspace =>
          workspace.id === 'workspace-b'
            ? {
                ...workspace,
                spaces: [
                  ...workspace.spaces,
                  createSpace('space-snap', { x: 104, y: 500, width: 400, height: 400 }, []),
                ],
              }
            : workspace,
        ),
      }))
      magneticSnappingEnabledRef.current = true
      switchTo('workspace-b')

      press(view, 'space-b', INSIDE_A)
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const b = useAppStore.getState().workspaces.find(workspace => workspace.id === 'workspace-b')
      expect(b?.spaces[0].rect?.x).toBe(104)
    })
  })
})
