import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ReactFlowProvider, type Node } from '@xyflow/react'
import { CanvasStoreTestProvider } from '../../support/canvasStoreTestHarness'
import {
  useCanvasInteractionCommands,
  useCanvasSelectionCommands,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
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

// Only this helper knows how the canvas view (the selection of the canvas store) and the live
// nodes of a gesture reach the hook.
function renderCanvasNodesStore() {
  return renderHook(
    () => ({
      store: useWorkspaceCanvasNodesStore({
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/workspace-1',
        nodes: [],
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
      }),
      selection: useCanvasSelectionCommands(),
      interaction: useCanvasInteractionCommands(),
    }),
    {
      wrapper: ({ children }) => (
        <CanvasStoreTestProvider workspaceId="workspace-1">
          <ReactFlowProvider>{children}</ReactFlowProvider>
        </CanvasStoreTestProvider>
      ),
    },
  )
}

describe('workspace document commands: the canvas view of the store', () => {
  afterEach(() => {
    cleanup()
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
  })

  it('writes nothing when an updater changes nothing but the canvas view differs in canvas-only fields', () => {
    const stored = [sized('t1', 0), sized('n2', 400)]
    seed(stored)
    const view = renderCanvasNodesStore()
    // The canvas view: both windows selected, which the document nodes do not say.
    act(() => view.result.current.selection.setNodeIds(['t1', 'n2']))
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    act(() => {
      view.result.current.store.setNodes(prev => prev)
    })

    expect(listener).not.toHaveBeenCalled()
    expect(useAppStore.getState().workspaces[0].nodes).toBe(stored)

    act(() => {
      view.result.current.store.setNodes(prev =>
        prev.map(node =>
          node.id === 'n2' ? { ...node, data: { ...node.data, title: 'changed' } } : node,
        ),
      )
    })
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    const after = useAppStore.getState().workspaces[0].nodes
    expect(after[0]).toMatchObject({ id: 't1', selected: true, position: stored[0].position })
    expect(after[1].data.title).toBe('changed')
  })

  // A canvas write computes from the committed view (S6, PR 4): while a gesture holds live
  // positions, an updater sees the committed ones and commits them. Until PR 4 it saw the live
  // ones.
  it.each([{ liveGesture: true }, { liveGesture: false }])(
    'seeds updaters with the committed positions (live gesture: $liveGesture)',
    ({ liveGesture }) => {
      const stored = [sized('t1', 0), sized('n2', 400)]
      seed(stored)
      const view = renderCanvasNodesStore()
      if (liveGesture) {
        act(() =>
          view.result.current.interaction.publishLiveNodes(
            new Map([['t1', { position: { x: 999, y: 0 } }]]),
          ),
        )
      }
      let seenX: number | null = null

      act(() => {
        view.result.current.store.setNodes(prev => {
          seenX = prev.find(node => node.id === 't1')?.position.x ?? null
          return prev.map(node =>
            node.id === 'n2' ? { ...node, data: { ...node.data, title: 'changed' } } : node,
          )
        })
      })

      expect(seenX).toBe(0)
      const committed = useAppStore.getState().workspaces[0].nodes
      expect(committed.find(node => node.id === 't1')?.position.x).toBe(0)
      expect(committed.find(node => node.id === 'n2')?.data.title).toBe('changed')
    },
  )
})
