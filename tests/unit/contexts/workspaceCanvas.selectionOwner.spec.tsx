import { useLayoutEffect, useRef } from 'react'
import { act, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasSelectNode } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectNode'
import { useWorkspaceCanvasState } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasState'
import { useWorkspaceCanvasApplyNodeChanges } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges'
import type { WorkspaceCanvasNodeDragSession } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import { projectCollapsedNodes } from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'
import type { WorkspaceSpaceState } from '@contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

function renderSelectionOwner() {
  const initialNodes = ['peer', 'compact'].map(id => ({
    ...pixelNode({ kind: 'note', sessionId: '', note: { text: id } }),
    id,
  }))
  const spaces: WorkspaceSpaceState[] = []
  const order: string[] = []
  const session: WorkspaceCanvasNodeDragSession = {
    nodeDragPointerAnchorRef: { current: null },
    nodeSpaceFramePreview: null,
    dragBaselinePositionByIdRef: { current: null },
    dragBaselineSpaceRectByIdRef: { current: null },
    beginNodeDragSession: vi.fn(),
    endNodeDragSession: vi.fn(),
    clearNodeDragProjection: vi.fn(),
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
        persistedMinimapVisible: false,
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
        setSelectedNodeIds: canvas.setSelectedNodeIds,
        setSelectedSpaceIds: canvas.setSelectedSpaceIds,
        selectedNodeIdsRef: canvas.selectedNodeIdsRef,
        selectedSpaceIdsRef: canvas.selectedSpaceIdsRef,
        spacesRef: canvas.spacesRef,
      })
      return { canvas, apply, select }
    },
    { wrapper: ReactFlowProvider },
  )
  return { ...hook, order }
}

describe('canvas selection owner', () => {
  it('keeps the window projection stable when the active window is selected again', () => {
    const { result } = renderSelectionOwner()
    act(() => result.current.select('compact'))
    const selection = result.current.canvas.selectedNodeIds
    const windows = result.current.canvas.flowNodes

    // Native activation can re-enter selection while a viewport gesture is frozen. The
    // public selection writer owns equality for every caller, including updater functions.
    for (let activation = 0; activation < 3; activation += 1) {
      act(() => result.current.select('compact'))
      expect(result.current.canvas.selectedNodeIds).toBe(selection)
      expect(result.current.canvas.flowNodes).toBe(windows)
    }
    act(() => result.current.canvas.setSelectedNodeIds(ids => [...ids]))
    expect(result.current.canvas.flowNodes).toBe(windows)

    act(() => result.current.select('peer', { toggle: true }))
    expect(result.current.canvas.selectedNodeIds).toEqual(['peer', 'compact'])
    expect(result.current.canvas.flowNodes).not.toBe(windows)
  })

  it('replaces selection in the node-change transaction before publishing a compact drag frame', () => {
    const { result, rerender, order } = renderSelectionOwner()
    act(() => result.current.apply([{ type: 'select', id: 'peer', selected: true }]))
    expect(result.current.canvas.selectedNodeIds).toEqual(['peer'])
    order.length = 0

    act(() =>
      result.current.apply([
        { type: 'select', id: 'peer', selected: false },
        { type: 'select', id: 'compact', selected: true },
        { type: 'position', id: 'compact', position: { x: 160, y: 110 }, dragging: true },
      ]),
    )
    expect(order).toEqual(['select:compact', 'publish'])
    expect(result.current.canvas.selectedNodeIdsRef.current).toEqual(['compact'])
    expect(
      result.current.canvas.flowNodes.filter(node => node.selected).map(node => node.id),
    ).toEqual(['compact'])
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
    result.current.canvas.selectionDraftRef.current = null

    act(() => result.current.apply([{ type: 'remove', id: 'peer' }]))
    expect(result.current.canvas.selectedNodeIds).toEqual([])
    expect(result.current.canvas.flowNodes.map(node => node.id)).toEqual(['compact'])
  })
})
