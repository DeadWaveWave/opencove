import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceStateHandlers } from '../../../src/app/renderer/shell/hooks/useWorkspaceStateHandlers'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

function workspace(): WorkspaceState {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace-1',
    worktreesRoot: '/tmp/workspace-1',
    nodes: [pixelNode({ width: 300, height: 200 })],
    spaces: [
      {
        id: 'space-1',
        name: 'Space',
        directoryPath: '/tmp/workspace-1',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['terminal-1'],
        rect: { x: 0, y: 0, width: 400, height: 300 },
      },
    ],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

// Only this helper knows how the canvas node store is wired to the app store.
function renderCanvasNodesStore() {
  return renderHook(
    () => {
      const nodes = useAppStore(state => state.workspaces[0].nodes)
      const spaces = useAppStore(state => state.workspaces[0].spaces)
      const spacesRef = React.useRef(spaces)
      spacesRef.current = spaces
      const { handleWorkspaceNodesChange, handleWorkspaceSpacesChange } = useWorkspaceStateHandlers(
        { requestPersistFlush: vi.fn() },
      )
      return useWorkspaceCanvasNodesStore({
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/workspace-1',
        nodes,
        spacesRef,
        onNodesChange: handleWorkspaceNodesChange,
        onSpacesChange: handleWorkspaceSpacesChange,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
      })
    },
    { wrapper: ({ children }) => <ReactFlowProvider>{children}</ReactFlowProvider> },
  )
}

describe('workspace document commands: nodes and Spaces change in one store update', () => {
  afterEach(() => {
    cleanup()
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
  })

  it('notifies store listeners once when resizeNode grows the owning Space', () => {
    useAppStore.setState({ workspaces: [workspace()], activeWorkspaceId: 'workspace-1' })
    const view = renderCanvasNodesStore()
    const spacesBefore = useAppStore.getState().workspaces[0].spaces
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    act(() => {
      view.result.current.resizeNode('terminal-1', {
        position: { x: 100, y: 80 },
        size: { width: 600, height: 500 },
      })
    })
    unsubscribe()

    const after = useAppStore.getState().workspaces[0]
    expect(after.nodes[0].data.width).toBe(600)
    expect(after.spaces).not.toBe(spacesBefore)
    expect(after.spaces[0].rect?.width).toBeGreaterThan(400)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
