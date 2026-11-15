import React, { type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { useWorkspaceCanvasState } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasState'
import {
  useCanvasSelectionCommands,
  useReadCanvasSelection,
} from '@contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type { WorkspaceSpaceState } from '@contexts/workspace/presentation/renderer/types'
import { CanvasStoreTestProvider } from '../../support/canvasStoreTestHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <CanvasStoreTestProvider>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </CanvasStoreTestProvider>
  )
}

function space(id: string): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/tmp/repo',
    targetMountId: null,
    labelColor: null,
    nodeIds: [],
    rect: { x: 0, y: 0, width: 600, height: 400 },
  }
}

// Decision 8 of #692: a selection never names a Space that no longer exists.
describe('canvas selection prune', () => {
  it('drops a selected Space that leaves the spaces prop, and keeps the others', () => {
    const nodes = [{ ...pixelNode({ kind: 'note', sessionId: '', note: { text: 'n' } }), id: 'n1' }]
    const { result, rerender } = renderHook(
      ({ spaces }: { spaces: WorkspaceSpaceState[] }) => {
        useWorkspaceCanvasState({
          workspaceId: 'prune',
          nodes,
          spaces,
          viewport: { x: 0, y: 0, zoom: 1 },
        })
        return { readSelection: useReadCanvasSelection(), selection: useCanvasSelectionCommands() }
      },
      { wrapper: Wrapper, initialProps: { spaces: [space('a'), space('b')] } },
    )
    act(() => result.current.selection.setSpaceIds(['a', 'b']))
    expect(result.current.readSelection().spaceIds).toEqual(['a', 'b'])

    rerender({ spaces: [space('b')] })
    expect(result.current.readSelection().spaceIds).toEqual(['b'])

    rerender({ spaces: [] })
    expect(result.current.readSelection().spaceIds).toEqual([])
  })

  it('leaves the node selection to the node prune and keeps an unchanged selection', () => {
    const nodes = [{ ...pixelNode({ kind: 'note', sessionId: '', note: { text: 'n' } }), id: 'n1' }]
    const spaces = [space('a')]
    const { result, rerender } = renderHook(
      () => {
        useWorkspaceCanvasState({
          workspaceId: 'prune',
          nodes,
          spaces,
          viewport: { x: 0, y: 0, zoom: 1 },
        })
        return { readSelection: useReadCanvasSelection(), selection: useCanvasSelectionCommands() }
      },
      { wrapper: Wrapper },
    )
    act(() => result.current.selection.setSpaceIds(['a']))
    const before = result.current.readSelection()

    rerender()

    expect(result.current.readSelection()).toBe(before)
  })
})
