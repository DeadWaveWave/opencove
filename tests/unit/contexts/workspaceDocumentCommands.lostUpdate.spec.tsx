import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { updateWorkspacesWithTerminalGeometry } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
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
    nodes: [pixelNode()],
    spaces: [],
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
      // The shell hands the canvas the active workspace's nodes and its real write handler.
      const nodes = useAppStore(state => state.workspaces[0].nodes)
      const { handleWorkspaceNodesChange } = useWorkspaceStateHandlers({
        requestPersistFlush: vi.fn(),
      })
      return useWorkspaceCanvasNodesStore({
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/workspace-1',
        nodes,
        spacesRef: { current: [] },
        onNodesChange: handleWorkspaceNodesChange,
        onSpacesChange: vi.fn(),
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
      })
    },
    { wrapper: ({ children }) => <ReactFlowProvider>{children}</ReactFlowProvider> },
  )
}

describe('workspace document commands: lost update between runtime geometry and a user rename', () => {
  afterEach(() => {
    cleanup()
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
  })

  it('keeps terminalGeometry when renameTerminalTitle runs in the same act, before a re-render', () => {
    useAppStore.setState({ workspaces: [workspace()], activeWorkspaceId: 'workspace-1' })

    const view = renderCanvasNodesStore()

    act(() => {
      // Runtime observation (PTY geometry) lands in the app store, as onGeometry does.
      useAppStore.getState().setWorkspaces(previous => {
        const result = updateWorkspacesWithTerminalGeometry({
          workspaces: previous,
          sessionId: 'session-1',
          cols: 120,
          rows: 40,
        })
        expect(result.didChange).toBe(true)
        return result.nextWorkspaces
      })
      // Same act, no re-render yet: the user renames the terminal through the canvas node store.
      view.result.current.renameTerminalTitle('terminal-1', 'Renamed')
    })

    const node = useAppStore.getState().workspaces[0].nodes[0]
    expect(node.data.title).toBe('Renamed')
    expect(node.data.terminalGeometry).toEqual({ cols: 120, rows: 40 })
  })
})
