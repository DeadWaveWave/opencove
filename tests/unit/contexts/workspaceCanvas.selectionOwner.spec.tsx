import React, { useLayoutEffect, useRef, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { ReactFlowProvider, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasSelectNode } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectNode'
import { useWorkspaceCanvasState } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasState'
import { useWorkspaceCanvasApplyNodeChanges } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges'
import { useWorkspaceCanvasSpaceOwnership } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership'
import type { WorkspaceCanvasNodeDragSession } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import {
  useCanvasSelectionCommands,
  useReadCanvasSelection,
} from '@contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { projectCollapsedNodes } from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { CanvasStoreTestProvider } from '../../support/canvasStoreTestHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

function SelectionOwnerWrapper({ children }: { children: ReactNode }) {
  return (
    <CanvasStoreTestProvider>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </CanvasStoreTestProvider>
  )
}

function renderSelectionOwner() {
  const initialNodes = ['peer', 'compact'].map(id => ({
    ...pixelNode({ kind: 'note', sessionId: '', note: { text: id } }),
    id,
  }))
  // A Space without a rect holds no window geometry. It exists so that a selected Space survives
  // the prune, and the drag-start case has a selected Space to clear.
  const spaces: WorkspaceSpaceState[] = [
    {
      id: 's',
      name: 's',
      directoryPath: '/tmp/repo',
      targetMountId: null,
      labelColor: null,
      nodeIds: [],
      rect: null,
    },
  ]
  const order: string[] = []
  const session: WorkspaceCanvasNodeDragSession = {
    nodeDragPointerAnchorRef: { current: null },
    nodeSpaceFramePreview: null,
    dragBaselinePositionByIdRef: { current: null },
    dragBaselineSpaceRectByIdRef: { current: null },
    beginNodeDragSession: vi.fn(),
    endNodeDragSession: vi.fn(),
    clearNodeDragProjection: vi.fn(),
    captureDragStartSpaceSelection: vi.fn(),
    getDragStartSpaceSelection: () => null,
    clearDragStartSpaceSelection: vi.fn(),
    applyPendingReleaseProjection: nodes => nodes,
    projectNodeDrag: ({ currentNodes }) => ({
      nextNodes: currentNodes,
      nextDraggedNodePositionById: new Map(),
      nextSpaceFramePreview: null,
    }),
  }
  const hook = renderHook(
    () => {
      const canvas = useWorkspaceCanvasState({
        workspaceId: 'selection-owner',
        nodes: initialNodes,
        spaces,
        viewport: { x: 0, y: 0, zoom: 0.28 },
      })
      const nodesRef = useRef(canvas.flowNodes)
      const isNodeDraggingRef = useRef(false)
      useLayoutEffect(() => {
        nodesRef.current = canvas.flowNodes
      }, [canvas.flowNodes])
      const apply = useWorkspaceCanvasApplyNodeChanges({
        nodesRef,
        onSelectedNodeIdsChange: ids => {
          order.push(`select:${ids.join(',')}`)
          canvas.syncSelectedNodeIds(ids)
        },
        onNodesChange: nodes => {
          order.push('publish')
          canvas.setCanvasNodes(nodes)
        },
        clearAgentLaunchToken: vi.fn(),
        normalizePosition: (_id, point) => point,
        applyPendingScrollbacks: nodes => nodes,
        isNodeDraggingRef,
        nodeDragSession: session,
      })
      const select = useWorkspaceCanvasSelectNode({
        setNodes: canvas.setCanvasNodes,
        spacesRef: canvas.spacesRef,
      })
      const exclusiveNodeDragAnchorIdRef = useRef<string | null>(null)
      const reactFlow = {
        screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
        getNodes: () => canvas.flowNodes,
        getNode: (id: string) => canvas.flowNodes.find(node => node.id === id),
      } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>
      const ownership = useWorkspaceCanvasSpaceOwnership({
        workspaceId: 'selection-owner',
        workspacePath: '/tmp/repo',
        reactFlow,
        spacesRef: canvas.spacesRef,
        nodeDragSession: session,
        exclusiveNodeDragAnchorIdRef,
        setNodes: canvas.setCanvasNodes,
        onSpacesChange: vi.fn(),
        hideWorktreeMismatchDropWarning: true,
      })
      return {
        canvas,
        apply,
        select,
        ownership,
        selection: useCanvasSelectionCommands(),
        readSelection: useReadCanvasSelection(),
      }
    },
    { wrapper: SelectionOwnerWrapper },
  )
  return { ...hook, order }
}

type Rendered = ReturnType<typeof renderSelectionOwner>['result']

// Invariant 1 of #692: the nodes flagged `selected` in `flowNodes` are exactly the ids in the store.
function expectFlagsToMatchStore(result: Rendered): void {
  const flagged = result.current.canvas.flowNodes.filter(node => node.selected).map(node => node.id)
  expect(flagged).toEqual(result.current.readSelection().nodeIds)
}

describe('canvas selection owner', () => {
  it('keeps the window projection stable when the active window is selected again', () => {
    const { result } = renderSelectionOwner()
    act(() => result.current.select('compact'))
    expectFlagsToMatchStore(result)
    const selection = result.current.canvas.selectedNodeIds
    const windows = result.current.canvas.flowNodes

    // Native activation can re-enter selection while a viewport gesture is frozen. The
    // public selection writer owns equality for every caller, including updater functions.
    for (let activation = 0; activation < 3; activation += 1) {
      act(() => result.current.select('compact'))
      expect(result.current.canvas.selectedNodeIds).toBe(selection)
      expect(result.current.canvas.flowNodes).toBe(windows)
    }
    act(() => result.current.selection.setNodeIds([...result.current.readSelection().nodeIds]))
    expect(result.current.canvas.flowNodes).toBe(windows)

    act(() => result.current.select('peer', { toggle: true }))
    expect(result.current.canvas.selectedNodeIds).toEqual(['peer', 'compact'])
    expect(result.current.canvas.flowNodes).not.toBe(windows)
    expectFlagsToMatchStore(result)
  })

  it('replaces selection in the node-change transaction before publishing a compact drag frame', () => {
    const { result, rerender, order } = renderSelectionOwner()
    act(() => result.current.apply([{ type: 'select', id: 'peer', selected: true }]))
    expect(result.current.canvas.selectedNodeIds).toEqual(['peer'])
    expectFlagsToMatchStore(result)
    order.length = 0

    act(() =>
      result.current.apply([
        { type: 'select', id: 'peer', selected: false },
        { type: 'select', id: 'compact', selected: true },
        { type: 'position', id: 'compact', position: { x: 160, y: 110 }, dragging: true },
      ]),
    )
    expect(order).toEqual(['select:compact', 'publish'])
    expect(result.current.readSelection().nodeIds).toEqual(['compact'])
    expect(
      result.current.canvas.flowNodes.filter(node => node.selected).map(node => node.id),
    ).toEqual(['compact'])
    expectFlagsToMatchStore(result)
    const projected = projectCollapsedNodes(result.current.canvas.flowNodes, [], {
      collapsedNodeIds: { compact: true },
      collapsedSpaceIds: {},
    })
    expect(projected.find(node => node.id === 'compact')).toMatchObject({
      selected: true,
      width: 112,
      height: 96,
      position: { x: 160, y: 110 },
      data: { width: 300, height: 200 },
    })

    const selection = result.current.canvas.selectedNodeIds
    act(() => result.current.canvas.syncSelectedNodeIds(['compact']))
    rerender()
    expect(result.current.canvas.selectedNodeIds).toBe(selection)
    expect(order).toEqual(['select:compact', 'publish'])
  })

  it('clears a removed selection and leaves a custom selection draft in control', () => {
    const { result } = renderSelectionOwner()
    act(() => result.current.apply([{ type: 'select', id: 'peer', selected: true }]))
    result.current.canvas.selectionDraftRef.current = {
      startX: 0,
      startY: 0,
      currentX: 100,
      currentY: 100,
      pointerId: 1,
      toggleSelection: false,
      selectedNodeIdsAtStart: ['peer'],
      selectedSpaceIdsAtStart: [],
      startSpaceId: null,
      phase: 'active',
    }
    act(() => result.current.canvas.syncSelectedNodeIds([]))
    expect(result.current.canvas.selectedNodeIds).toEqual(['peer'])
    expect(result.current.readSelection().nodeIds).toEqual(['peer'])
    result.current.canvas.selectionDraftRef.current = null

    act(() => result.current.apply([{ type: 'remove', id: 'peer' }]))
    expect(result.current.canvas.selectedNodeIds).toEqual([])
    expect(result.current.readSelection().nodeIds).toEqual([])
    expect(result.current.canvas.flowNodes.map(node => node.id)).toEqual(['compact'])
    expectFlagsToMatchStore(result)
  })

  // Decision 6 of #692: a node drag start decides from the `selected` flag React Flow hands it,
  // because the select batch of the same pointer down has already written the store.
  describe('node drag start after the select batch of the same pointer down', () => {
    function startDrag(result: Rendered, nodeId: string, flag: boolean | undefined, shift = false) {
      const peer = result.current.canvas.flowNodes.find(node => node.id === nodeId)!
      const event = { clientX: 10, clientY: 10, shiftKey: shift } as React.MouseEvent
      act(() =>
        result.current.ownership.handleNodeDragStart(event, { ...peer, selected: flag }, [
          { ...peer, selected: flag },
        ]),
      )
    }

    it('replaces the selection and clears the selected Spaces for an unselected node', () => {
      const { result } = renderSelectionOwner()
      act(() => result.current.selection.setSpaceIds(['s']))
      expect(result.current.readSelection().spaceIds).toEqual(['s'])

      act(() => result.current.apply([{ type: 'select', id: 'peer', selected: true }]))
      // The batch already wrote the node; the node RF passes to the drag start still says false.
      expect(result.current.readSelection().nodeIds).toEqual(['peer'])
      startDrag(result, 'peer', false)

      expect(result.current.readSelection()).toMatchObject({ nodeIds: ['peer'], spaceIds: [] })
      expectFlagsToMatchStore(result)
    })

    it('keeps the selected Spaces and nodes when the node was already selected', () => {
      const { result } = renderSelectionOwner()
      act(() => result.current.selection.select({ nodeIds: ['peer', 'compact'], spaceIds: ['s'] }))

      startDrag(result, 'peer', true)

      expect(result.current.readSelection()).toMatchObject({
        nodeIds: ['peer', 'compact'],
        spaceIds: ['s'],
      })
    })

    it('keeps the selection of a shift drag start on an unselected node', () => {
      const { result } = renderSelectionOwner()
      act(() => result.current.selection.select({ nodeIds: ['compact'], spaceIds: ['s'] }))

      startDrag(result, 'peer', false, true)

      expect(result.current.readSelection()).toMatchObject({
        nodeIds: ['compact'],
        spaceIds: ['s'],
      })
    })
  })
})
