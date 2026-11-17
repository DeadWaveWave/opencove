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

  it('keeps the node ids in the store when a selected Space is removed', () => {
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
      { wrapper: Wrapper, initialProps: { spaces: [space('a')] } },
    )
    act(() => result.current.selection.select({ nodeIds: ['n1'], spaceIds: ['a'] }))

    rerender({ spaces: [] })

    expect(result.current.readSelection().spaceIds).toEqual([])
    expect(result.current.readSelection().nodeIds).toEqual(['n1'])
  })

  it('keeps an unchanged selection as the same object', () => {
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
    act(() => result.current.selection.select({ nodeIds: ['n1'], spaceIds: ['a'] }))
    const before = result.current.readSelection()

    rerender()

    expect(result.current.readSelection()).toBe(before)
  })
})

// Decision 8 and the node half of the prune: the selection names only nodes that exist.
describe('canvas selection prune of removed nodes', () => {
  function noteNode(id: string) {
    return { ...pixelNode({ kind: 'note', sessionId: '', note: { text: id } }), id }
  }

  function setup(initialNodes: ReturnType<typeof noteNode>[], spaces: WorkspaceSpaceState[]) {
    return renderHook(
      ({ nodes }: { nodes: ReturnType<typeof noteNode>[] }) => {
        useWorkspaceCanvasState({
          workspaceId: 'prune',
          nodes,
          spaces,
          viewport: { x: 0, y: 0, zoom: 1 },
        })
        return { readSelection: useReadCanvasSelection(), selection: useCanvasSelectionCommands() }
      },
      { wrapper: Wrapper, initialProps: { nodes: initialNodes } },
    )
  }

  it('drops a selected node that leaves the nodes prop, and keeps the others in order', () => {
    const { result, rerender } = setup([noteNode('n1'), noteNode('n2'), noteNode('n3')], [])
    act(() => result.current.selection.setNodeIds(['n1', 'n2', 'n3']))

    rerender({ nodes: [noteNode('n1'), noteNode('n3')] })
    expect(result.current.readSelection().nodeIds).toEqual(['n1', 'n3'])

    rerender({ nodes: [] })
    expect(result.current.readSelection().nodeIds).toEqual([])
  })

  it('keeps the Space ids when a selected node is removed', () => {
    const { result, rerender } = setup([noteNode('n1'), noteNode('n2')], [space('a')])
    act(() => result.current.selection.select({ nodeIds: ['n1'], spaceIds: ['a'] }))

    rerender({ nodes: [noteNode('n2')] })

    expect(result.current.readSelection().nodeIds).toEqual([])
    expect(result.current.readSelection().spaceIds).toEqual(['a'])
  })

  it('keeps node ids that exist when only Spaces change', () => {
    const { result, rerender } = setup([noteNode('n1')], [space('a')])
    act(() => result.current.selection.select({ nodeIds: ['n1'], spaceIds: ['a'] }))
    const before = result.current.readSelection()

    rerender({ nodes: [noteNode('n1')] })

    expect(result.current.readSelection()).toBe(before)
  })

  it('does not drop a node that the store names while the nodes prop is the same', () => {
    const nodes = [noteNode('n1')]
    const { result, rerender } = setup(nodes, [])
    act(() => result.current.selection.setNodeIds(['n1']))

    rerender({ nodes })

    expect(result.current.readSelection().nodeIds).toEqual(['n1'])
  })
})
