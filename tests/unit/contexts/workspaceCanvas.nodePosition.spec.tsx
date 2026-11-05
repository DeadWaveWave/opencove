import { act, renderHook } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { useNodePosition } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodePosition'
import { pixelNode } from './workspacePixelLayer.fixtures'

describe('window position subscription', () => {
  it('ignores a rebuilt equal position while observing real movement and removal', () => {
    const peer = pixelNode()
    const { result } = renderHook(
      () => ({
        store: useStoreApi(),
        position: useNodePosition(peer.id),
      }),
      { wrapper: ReactFlowProvider },
    )
    act(() => result.current.store.setState({ nodes: [peer] }))
    const before = result.current.position
    // The secondary drag layout recomputes Point objects for stationary peers too.
    act(() =>
      result.current.store.setState({ nodes: [{ ...peer, position: { ...peer.position } }] }),
    )
    expect(result.current.position).toBe(before)
    act(() => result.current.store.setState({ nodes: [{ ...peer, position: { x: 200, y: 80 } }] }))
    expect(result.current.position).toEqual({ x: 200, y: 80 })
    act(() => result.current.store.setState({ nodes: [] }))
    expect(result.current.position).toEqual({ x: 0, y: 0 })
    const absent = result.current.position
    act(() => result.current.store.setState({ nodes: [] }))
    expect(result.current.position).toBe(absent)
  })
})
