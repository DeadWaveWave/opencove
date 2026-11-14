import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

// Sized up front so ensureNodesHaveInitialDimensions leaves them alone.
function sized(id: string, x: number): Node<TerminalNodeData> {
  return { ...pixelNode(), id, position: { x, y: 0 }, initialWidth: 300, initialHeight: 200 }
}

function seed(nodes: Node<TerminalNodeData>[]): void {
  useAppStore.setState({
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/workspace-1',
        worktreesRoot: '',
        nodes,
        spaces: [],
        activeSpaceId: null,
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: false,
      } as WorkspaceState,
    ],
    activeWorkspaceId: 'workspace-1',
  })
}

// Only this helper knows how the canvas view and the live-gesture flag reach the hook.
function renderCanvasNodesStore(
  canvasNodes: Node<TerminalNodeData>[],
  { isLiveGestureActive = false }: { isLiveGestureActive?: boolean } = {},
) {
  const onNodesCommitted = vi.fn()
  const view = renderHook(
    () =>
      useWorkspaceCanvasNodesStore({
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/workspace-1',
        nodes: canvasNodes,
        spacesRef: { current: [] },
        onNodesCommitted,
        isLiveGestureActive: () => isLiveGestureActive,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
      }),
    { wrapper: ({ children }) => <ReactFlowProvider>{children}</ReactFlowProvider> },
  )
  return { ...view, onNodesCommitted }
}

describe('workspace document commands: the canvas view of the store', () => {
  afterEach(() => {
    cleanup()
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
  })

  it('writes nothing when an updater changes nothing but the canvas view differs in canvas-only fields', () => {
    const stored = [sized('t1', 0), sized('n2', 400)]
    seed(stored)
    const decorated = stored.map(node => ({ ...node, selected: true, dragHandle: '.drag' }))
    const view = renderCanvasNodesStore(decorated)
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    act(() => {
      view.result.current.setNodes(prev => prev)
    })

    expect(listener).not.toHaveBeenCalled()
    expect(view.onNodesCommitted).not.toHaveBeenCalled()
    expect(useAppStore.getState().workspaces[0].nodes).toBe(stored)

    act(() => {
      view.result.current.setNodes(prev =>
        prev.map(node =>
          node.id === 'n2' ? { ...node, data: { ...node.data, title: 'changed' } } : node,
        ),
      )
    })
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    const after = useAppStore.getState().workspaces[0].nodes
    expect(after[0]).toBe(decorated[0])
    expect(after[1].data.title).toBe('changed')
  })
})
