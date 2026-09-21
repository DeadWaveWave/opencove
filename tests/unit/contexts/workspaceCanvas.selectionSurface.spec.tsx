import { act, renderHook } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasNodesSelectionActive } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesSelectionActive'
import { pixelNode } from './workspacePixelLayer.fixtures'

function renderSelectionSurface(selectedNodeCount = 0) {
  return renderHook(
    ({ count }) => {
      const store = useStoreApi()
      useWorkspaceCanvasNodesSelectionActive(count)
      return store
    },
    { initialProps: { count: selectedNodeCount }, wrapper: ReactFlowProvider },
  )
}

describe('canvas selection surface ownership', () => {
  it('does not reactivate selection from React Flow nodes awaiting controlled projection', () => {
    const { result, rerender } = renderSelectionSurface(1)
    const peer = { ...pixelNode({ kind: 'note', sessionId: '' }), id: 'selected', selected: true }
    act(() => result.current.setState({ nodes: [peer] }))
    expect(result.current.getState().nodesSelectionActive).toBe(true)

    rerender({ count: 0 })
    expect(result.current.getState().nodesSelectionActive).toBe(false)
    // A controlled nodes update can land after the owner has already cleared selection.
    act(() => result.current.setState({ nodes: [{ ...peer }] }))
    expect(result.current.getState().nodesSelectionActive).toBe(false)
  })

  it('keeps native marquee in control and skips redundant store updates', () => {
    const { result, rerender } = renderSelectionSurface()
    act(() => result.current.setState({ userSelectionActive: true }))
    rerender({ count: 1 })
    expect(result.current.getState().nodesSelectionActive).toBe(false)
    act(() => result.current.setState({ userSelectionActive: false }))
    expect(result.current.getState().nodesSelectionActive).toBe(true)

    const writes = vi.fn()
    const unsubscribe = result.current.subscribe(writes)
    rerender({ count: 1 })
    expect(writes).not.toHaveBeenCalled()
    unsubscribe()
  })
})
