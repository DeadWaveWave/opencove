import { useRef, useState } from 'react'
import { act, fireEvent, renderHook } from '@testing-library/react'
import { ReactFlowProvider, useReactFlow, type Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasSpaceDrag } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag'
import { useCanvasCollapseStore } from '@contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { createNode, createSpace } from './workspaceNodeProjection.testUtils'

afterEach(() => {
  vi.useRealTimers()
  useCanvasCollapseStore.setState({ workspaces: {} })
})

function renderNestedResize() {
  const node = createNode({
    id: 'terminal',
    position: { x: 124, y: 104 },
    width: 640,
    height: 480,
  })
  const spaces = [
    createSpace({ id: 'parent', rect: { x: 0, y: 0, width: 1200, height: 900 }, nodeIds: [] }),
    createSpace({
      id: 'child',
      parentSpaceId: 'parent',
      rect: { x: 100, y: 80, width: 900, height: 700 },
      nodeIds: ['terminal'],
    }),
  ]
  const persist = vi.fn()
  const setSnapGuides = vi.fn()
  const hook = renderHook(
    () => {
      const flow = useReactFlow<Node<TerminalNodeData>>()
      const nodesRef = useRef([node])
      const spacesRef = useRef(spaces)
      const selectedNodeIdsRef = useRef<string[]>([])
      const selectedSpaceIdsRef = useRef<string[]>([])
      const [, setSpaces] = useState(spaces)
      const drag = useWorkspaceCanvasSpaceDrag({
        workspaceId: 'workspace',
        reactFlow: {
          ...flow,
          screenToFlowPosition: point => point,
          getZoom: () => 1,
        },
        nodesRef,
        spacesRef,
        selectedNodeIdsRef,
        selectedSpaceIdsRef,
        setNodes: update => {
          nodesRef.current = update(nodesRef.current)
        },
        onSpacesChange: next => {
          spacesRef.current = next
          setSpaces(next)
        },
        setSelectedNodeIds: () => {},
        setSelectedSpaceIds: () => {},
        magneticSnappingEnabledRef: { current: false },
        setSnapGuides,
        onRequestPersistFlush: persist,
        setContextMenu: () => {},
        cancelSpaceRename: () => {},
        setEmptySelectionPrompt: () => {},
      })
      return { ...drag, spaces: spacesRef.current, nodes: nodesRef.current }
    },
    { wrapper: ReactFlowProvider },
  )
  return { ...hook, persist }
}

describe('nested compact Space resize lifecycle', () => {
  it('reads collapse state at pointerdown and commits the same compact child frame shown in preview', () => {
    vi.useFakeTimers()
    const { result, persist } = renderNestedResize()
    act(() =>
      useCanvasCollapseStore.getState().update('workspace', state => ({
        ...state,
        collapsedNodeIds: { terminal: true },
      })),
    )
    const drag = (
      spaceId: string,
      start: { x: number; y: number },
      end: { x: number; y: number },
    ) => {
      act(() =>
        result.current.handleSpaceDragHandlePointerDown(
          {
            button: 0,
            clientX: start.x,
            clientY: start.y,
            pointerId: 7,
            shiftKey: false,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          } as unknown as React.PointerEvent<HTMLDivElement>,
          spaceId,
        ),
      )
      act(() => {
        fireEvent.pointerMove(window, { pointerId: 7, clientX: end.x, clientY: end.y, buttons: 1 })
        vi.advanceTimersByTime(20)
      })
      const preview = result.current.spaceFramePreview?.get(spaceId)
      act(() => fireEvent.pointerUp(window, { pointerId: 7, clientX: end.x, clientY: end.y }))
      expect(result.current.spaceFramePreview).toBeNull()
      expect(result.current.spaces.find(space => space.id === spaceId)?.rect).toEqual(preview)
      return preview
    }

    expect(drag('child', { x: 1000, y: 430 }, { x: 180, y: 430 })).toEqual({
      x: 100,
      y: 80,
      width: 224,
      height: 700,
    })
    expect(drag('child', { x: 296, y: 780 }, { x: 296, y: 90 })).toEqual({
      x: 100,
      y: 80,
      width: 224,
      height: 120,
    })
    expect(drag('parent', { x: 1200, y: 900 }, { x: 40, y: 40 })).toEqual({
      x: 0,
      y: 0,
      width: 324,
      height: 200,
    })
    expect(result.current.nodes[0].data).toMatchObject({ width: 640, height: 480 })
    expect(result.current.nodes[0].position).toEqual({ x: 124, y: 104 })
    expect(persist).toHaveBeenCalledTimes(3)
  })
})
