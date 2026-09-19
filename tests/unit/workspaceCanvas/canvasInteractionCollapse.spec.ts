import type { Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import {
  projectCanvasInteractionLayout,
  restoreCanvasInteractionLayout,
} from '@contexts/workspace/presentation/renderer/utils/canvasInteractionLayout'
import {
  projectCollapsedNodes,
  type CanvasCollapseState,
} from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'
import { useCanvasCollapseStore } from '@contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import { projectCanvasInteractionDrop } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession.collapse'
import { applySelectionDraft } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectionDraft.helpers'
import { handleSelectionRectNodeToggle } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.selectionRectToggle'

const node = (id: string, x = 0, y = 0): Node<TerminalNodeData> => ({
  id,
  position: { x, y },
  data: {
    title: id,
    kind: 'terminal',
    sessionId: id,
    width: 640,
    height: 480,
    status: 'running',
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    agent: null,
    task: null,
    note: null,
    image: null,
    document: null,
    website: null,
  },
})
const state: CanvasCollapseState = { collapsedNodeIds: { a: true, b: true }, collapsedSpaceIds: {} }
const space: WorkspaceSpaceState = {
  id: 'space',
  name: 'Space',
  nodeIds: ['a'],
  directoryPath: '/project',
  targetMountId: null,
  labelColor: null,
  rect: { x: 0, y: 0, width: 900, height: 800 },
}
afterEach(() => useCanvasCollapseStore.setState({ workspaces: {} }))

describe('displayed interaction geometry', () => {
  it('moves a compact card alongside another without pushing its invisible expanded rectangle', () => {
    const nodes = [node('a'), node('b', 400)]
    useCanvasCollapseStore.setState({ workspaces: { project: state } })
    const projected = projectCanvasInteractionDrop(
      {
        nodes,
        spaces: [],
        draggedNodeIds: ['a'],
        draggedNodePositionById: new Map([['a', { x: 40, y: 0 }]]),
        dropFlowPoint: { x: 50, y: 10 },
        dragDx: 40,
        dragDy: 0,
      },
      'project',
    )
    expect(projected.nextNodePositionById.get('a')).toEqual({ x: 40, y: 0 })
    expect(projected.nextNodePositionById.get('b')).toEqual({ x: 400, y: 0 })
    expect(nodes.map(item => [item.data.width, item.data.height])).toEqual([
      [640, 480],
      [640, 480],
    ])
  })

  it('keeps hidden children out of collision geometry and translates their canonical layout with a pushed Space', () => {
    const nodes = [node('a', 50, 70), node('outside', 1100)]
    const child: WorkspaceSpaceState = {
      ...space,
      id: 'nested',
      parentSpaceId: 'space',
      nodeIds: [],
      rect: { x: 100, y: 120, width: 500, height: 500 },
    }
    const collapsed: CanvasCollapseState = {
      collapsedNodeIds: {},
      collapsedSpaceIds: { space: true },
    }
    const view = projectCanvasInteractionLayout(nodes, [space, child], collapsed)
    expect(view.nodes.map(item => item.id)).toEqual(['outside'])
    expect(view.spaces.map(item => item.id)).toEqual(['space'])
    expect(view.spaces[0].rect?.width).toBe(360)
    const restored = restoreCanvasInteractionLayout(
      {
        nextSpaces: [{ ...view.spaces[0], rect: { ...view.spaces[0].rect!, x: 200, y: 100 } }],
        nextNodePositionById: new Map(),
      },
      nodes,
      [space, child],
      collapsed,
    )
    expect(restored.nextSpaces[0].rect).toEqual({ x: 200, y: 100, width: 900, height: 800 })
    expect(restored.nextSpaces[1].rect).toEqual({ x: 300, y: 220, width: 500, height: 500 })
    expect(restored.nextNodePositionById.get('a')).toEqual({ x: 250, y: 170 })
    const returnedToBaseline = restoreCanvasInteractionLayout(
      { nextSpaces: view.spaces, nextNodePositionById: new Map() },
      nodes,
      [space, child],
      collapsed,
    )
    expect(returnedToBaseline.nextNodePositionById.get('a')).toEqual({ x: 50, y: 70 })
    const rf = projectCollapsedNodes([{ ...nodes[0], selected: true }], [space], collapsed)
    expect(rf[0].selected).toBe(false)
    expect(rf[0].data.width).toBe(640)
  })

  it('box selection only uses displayed cards and excludes hidden Space children', () => {
    let nodes = [node('a'), { ...node('hidden', 400), selected: true }]
    const collapsed = { ...state, collapsedSpaceIds: { space: true as const } }
    const spaces = [
      { ...space, nodeIds: ['hidden'], rect: { x: 1000, y: 1000, width: 900, height: 800 } },
    ]
    const selectedNodeIdsRef = { current: [] as string[] }
    applySelectionDraft({
      draft: {
        startX: 400,
        startY: 10,
        currentX: 450,
        currentY: 40,
        pointerId: 1,
        toggleSelection: false,
        selectedNodeIdsAtStart: [],
        selectedSpaceIdsAtStart: [],
        startSpaceId: null,
        phase: 'active',
      },
      reactFlow: {
        screenToFlowPosition: point => point,
        getNodes: () => nodes,
      } as ReactFlowInstance<Node<TerminalNodeData>>,
      spaces,
      collapseState: collapsed,
      selectedNodeIdsRef,
      selectedSpaceIdsRef: { current: [] },
      setNodes: update => {
        nodes = update(nodes)
      },
      setSelectedNodeIds: vi.fn(),
      setSelectedSpaceIds: vi.fn(),
    })
    expect(selectedNodeIdsRef.current).toEqual([])
    expect(nodes.every(item => !item.selected)).toBe(true)
    expect(nodes[0].data.width).toBe(640)
  })

  it('shift-toggle ignores a compact card’s former body area', () => {
    const target = document.createElement('div')
    target.className = 'react-flow__nodesselection-rect'
    const toggleNode = vi.fn()
    const nodes = projectCollapsedNodes([{ ...node('a'), selected: true }], [], state)
    const event = {
      button: 0,
      shiftKey: true,
      target,
      clientX: 450,
      clientY: 20,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }
    const params = {
      event,
      reactFlow: {
        screenToFlowPosition: (point: { x: number; y: number }) => point,
        getNodes: () => nodes,
      } as ReactFlowInstance<Node<TerminalNodeData>>,
      toggleNode,
      queueIgnoreNextPaneClick: vi.fn(),
    }
    expect(handleSelectionRectNodeToggle(params)).toBe(false)
    expect(handleSelectionRectNodeToggle({ ...params, event: { ...event, clientX: 100 } })).toBe(
      true,
    )
    expect(toggleNode).toHaveBeenCalledWith('a')
  })
})
