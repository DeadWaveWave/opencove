import { act, renderHook } from '@testing-library/react'
import { ReactFlowProvider, useReactFlow, useStoreApi } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_CANVAS_COLLAPSE,
  projectCollapsedNodes,
} from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'
import { createNode } from '../contexts/workspaceNodeProjection.testUtils'

describe('collapsed React Flow geometry', () => {
  it('keeps selection bounds compact through every controlled drag update before remeasurement', () => {
    const canonical = {
      ...createNode({ id: 'node', position: { x: 100, y: 120 }, width: 640, height: 480 }),
      selected: true,
      initialWidth: 640,
      initialHeight: 480,
    }
    const { result } = renderHook(() => ({ flow: useReactFlow(), store: useStoreApi() }), {
      wrapper: ReactFlowProvider,
    })

    for (const x of [100, 108, 137, 190]) {
      const projected = projectCollapsedNodes([{ ...canonical, position: { x, y: 120 } }], [], {
        collapsedNodeIds: { node: true },
        collapsedSpaceIds: {},
      })
      act(() => result.current.store.getState().setNodes(projected))
      expect(result.current.flow.getNodesBounds(['node'])).toEqual({
        x,
        y: 120,
        width: 112,
        height: 96,
      })
      expect(projected[0].data.width).toBe(640)
      expect(projected[0].data.height).toBe(480)
    }
  })

  it('rejects stale expanded and collapsed measurements at both presentation transitions', () => {
    const canonical = {
      ...createNode({ id: 'node', position: { x: 0, y: 0 }, width: 640, height: 480 }),
      width: 640,
      height: 480,
      measured: { width: 640, height: 480 },
      initialWidth: 640,
      initialHeight: 480,
    }
    const collapsed = projectCollapsedNodes([canonical], [], {
      collapsedNodeIds: { node: true },
      collapsedSpaceIds: {},
    })[0]
    const { result } = renderHook(() => ({ flow: useReactFlow(), store: useStoreApi() }), {
      wrapper: ReactFlowProvider,
    })
    act(() => result.current.store.getState().setNodes([collapsed]))
    expect(result.current.flow.getNodesBounds(['node'])).toMatchObject({ width: 112, height: 96 })

    const measuredCollapsed = { ...collapsed, measured: { width: 112, height: 96 } }
    const [expanded] = projectCollapsedNodes([measuredCollapsed], [], EMPTY_CANVAS_COLLAPSE)
    act(() => result.current.store.getState().setNodes([expanded]))
    expect(result.current.flow.getNodesBounds(['node'])).toMatchObject({ width: 640, height: 480 })
    expect(expanded.data).toMatchObject({ width: 640, height: 480 })
    expect(canonical.measured).toEqual({ width: 640, height: 480 })
  })
})
