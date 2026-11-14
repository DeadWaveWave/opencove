import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

function workspace(id: string, title: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: `/tmp/${id}`,
    nodes: [pixelNode({ title })],
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

// Only this helper knows how the canvas node store is wired to the app store.
function renderCanvasNodesStore(initialWorkspaceId: string) {
  return renderHook(
    ({ workspaceId }: { workspaceId: string }) => {
      const nodes = useAppStore(
        state => state.workspaces.find(candidate => candidate.id === workspaceId)!.nodes,
      )
      return useWorkspaceCanvasNodesStore({
        workspaceId,
        workspacePath: `/tmp/${workspaceId}`,
        nodes,
        spacesRef: { current: [] },
        onNodesCommitted: () => undefined,
        isLiveGestureActive: () => false,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
      })
    },
    {
      initialProps: { workspaceId: initialWorkspaceId },
      wrapper: ({ children }) => <ReactFlowProvider>{children}</ReactFlowProvider>,
    },
  )
}

describe('workspace document commands: a late canvas write lands in the workspace that started it', () => {
  afterEach(() => {
    cleanup()
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
  })

  it('renames in A and leaves B untouched when the closure of A runs after a switch to B', () => {
    useAppStore.setState({
      workspaces: [workspace('workspace-a', 'A title'), workspace('workspace-b', 'B title')],
      activeWorkspaceId: 'workspace-a',
    })
    const view = renderCanvasNodesStore('workspace-a')
    const renameInA = view.result.current.renameTerminalTitle

    act(() => {
      useAppStore.setState({ activeWorkspaceId: 'workspace-b' })
    })
    view.rerender({ workspaceId: 'workspace-b' })
    const workspaceBBefore = useAppStore.getState().workspaces[1]
    const nodesInB = view.result.current.nodesRef.current
    expect(nodesInB).toBe(workspaceBBefore.nodes)

    act(() => {
      renameInA('terminal-1', 'Renamed late')
    })

    const [workspaceA, workspaceB] = useAppStore.getState().workspaces
    expect(workspaceA.nodes[0].data.title).toBe('Renamed late')
    expect(workspaceB).toBe(workspaceBBefore)
    expect(view.result.current.nodesRef.current).toBe(nodesInB)
  })
})
