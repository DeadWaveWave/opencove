import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { CanvasStoreTestProvider } from '../../support/canvasStoreTestHarness'
import {
  useCanvasInteractionCommands,
  useCanvasSelectionCommands,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'
import { readDefaultAgentSettings } from '../../support/agentSettingsReader'

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
  // The provider follows the workspace the hook is rendered for, as the canvas's does.
  const provided = { workspaceId: initialWorkspaceId }
  const view = renderHook(
    ({ workspaceId }: { workspaceId: string }) => {
      const nodes = useAppStore(
        state => state.workspaces.find(candidate => candidate.id === workspaceId)!.nodes,
      )
      const store = useWorkspaceCanvasNodesStore({
        workspaceId,
        workspacePath: `/tmp/${workspaceId}`,
        nodes,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
        readAgentSettings: readDefaultAgentSettings,
      })
      // The canvas store of the render: its selection and its live nodes are the canvas of that
      // workspace, as during a gesture in it.
      return {
        ...store,
        selection: useCanvasSelectionCommands(),
        interaction: useCanvasInteractionCommands(),
      }
    },
    {
      initialProps: { workspaceId: initialWorkspaceId },
      wrapper: ({ children }) => (
        <CanvasStoreTestProvider workspaceId={provided.workspaceId}>
          <ReactFlowProvider>{children}</ReactFlowProvider>
        </CanvasStoreTestProvider>
      ),
    },
  )
  return {
    ...view,
    rerender: (props: { workspaceId: string }) => {
      provided.workspaceId = props.workspaceId
      view.rerender(props)
    },
  }
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

    act(() => {
      renameInA('terminal-1', 'Renamed late')
    })

    const [workspaceA, workspaceB] = useAppStore.getState().workspaces
    expect(workspaceA.nodes[0].data.title).toBe('Renamed late')
    expect(workspaceB).toBe(workspaceBBefore)
  })

  // The canvas state of the workspace that is shown (a selection and live positions, as during a
  // gesture in B) is B's: a write of A computes from the document of A and the canvas store of the
  // render that made it.
  it('does not copy the canvas state of the shown workspace onto nodes of the writing workspace', () => {
    useAppStore.setState({
      workspaces: [workspace('workspace-a', 'A title'), workspace('workspace-b', 'B title')],
      activeWorkspaceId: 'workspace-a',
    })
    const view = renderCanvasNodesStore('workspace-a')
    const renameInA = view.result.current.renameTerminalTitle
    const nodeInABefore = useAppStore.getState().workspaces[0].nodes[0]

    act(() => {
      useAppStore.setState({ activeWorkspaceId: 'workspace-b' })
    })
    view.rerender({ workspaceId: 'workspace-b' })
    act(() => {
      view.result.current.selection.setNodeIds(['terminal-1'])
      view.result.current.interaction.publishLiveNodes(
        new Map([['terminal-1', { position: { x: 777, y: 777 } }]]),
      )
    })

    act(() => {
      renameInA('terminal-1', 'Renamed late')
    })

    const nodeInA = useAppStore.getState().workspaces[0].nodes[0]
    expect(nodeInA.data.title).toBe('Renamed late')
    expect(nodeInA.selected).toBeUndefined()
    expect(nodeInA.position).toBe(nodeInABefore.position)
  })
})
