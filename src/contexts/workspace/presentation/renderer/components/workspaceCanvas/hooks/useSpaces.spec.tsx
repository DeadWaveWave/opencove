import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { ReactFlowProvider, type Node, type ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { TerminalNodeData, WorkspaceSpaceState, WorkspaceState } from '../../../types'
import { replaceWorkspaceSpaces } from '../../../store/workspaceDocumentCommands'
import { useWorkspaceCanvasSpaces } from './useSpaces'
import { CanvasStoreTestProvider } from '../../../../../../../../tests/support/canvasStoreTestHarness'

const NODE: Node<TerminalNodeData> = {
  id: 'node-1',
  type: 'terminal',
  position: { x: 0, y: 0 },
  data: {
    sessionId: 'session-1',
    title: 'Terminal',
    width: 400,
    height: 300,
    kind: 'terminal',
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    agent: null,
    task: null,
    note: null,
    image: null,
    document: null,
    website: null,
  },
}

const ACTIVE_SPACE: WorkspaceSpaceState = {
  id: 'space-1',
  name: 'Space 1',
  directoryPath: '/tmp/space-1',
  targetMountId: null,
  labelColor: null,
  nodeIds: [NODE.id],
  rect: {
    x: 0,
    y: 0,
    width: 600,
    height: 400,
  },
}

function TestHarnessBody({
  activeSpaceId,
  spaces,
  reactFlow,
}: {
  activeSpaceId: string | null
  spaces: WorkspaceSpaceState[]
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
}): React.JSX.Element {
  useWorkspaceCanvasSpaces({
    workspaceId: 'workspace-1',
    activeSpaceId,
    onActiveSpaceChange: vi.fn(),
    workspacePath: '/tmp/workspace',
    focusNodeTargetZoom: 1,
    standardWindowSizeBucket: 'regular',
    reactFlow,
    nodes: [NODE],
    updateCanvasDocument: vi.fn(),
    spaces,
  })

  return <div />
}

function TestHarness(props: React.ComponentProps<typeof TestHarnessBody>): React.JSX.Element {
  return (
    <CanvasStoreTestProvider workspaceId="workspace-1">
      <TestHarnessBody {...props} />
    </CanvasStoreTestProvider>
  )
}

describe('useWorkspaceCanvasSpaces', () => {
  // The hook reads the committed document, so the store holds the Space the canvas shows.
  beforeEach(() => {
    useAppStore.setState({
      workspaces: [
        {
          id: 'workspace-1',
          name: 'Workspace',
          path: '/tmp/workspace',
          worktreesRoot: '',
          nodes: [NODE],
          spaces: [ACTIVE_SPACE],
          activeSpaceId: 'space-1',
          spaceArchiveRecords: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: false,
        } as WorkspaceState,
      ],
      activeWorkspaceId: 'workspace-1',
    })
  })

  afterEach(() => {
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
  })

  it('fits all spaces when active space is cleared but still exists', async () => {
    const reactFlow = {
      fitView: vi.fn(),
      setViewport: vi.fn(),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>

    const rendered = render(
      <ReactFlowProvider>
        <TestHarness activeSpaceId="space-1" spaces={[ACTIVE_SPACE]} reactFlow={reactFlow} />
      </ReactFlowProvider>,
    )

    rendered.rerender(
      <ReactFlowProvider>
        <TestHarness activeSpaceId={null} spaces={[ACTIVE_SPACE]} reactFlow={reactFlow} />
      </ReactFlowProvider>,
    )

    await waitFor(() => {
      expect(reactFlow.fitView).toHaveBeenCalledTimes(1)
    })
  })

  it('does not fit all spaces when the active space disappears during archive', async () => {
    const reactFlow = {
      fitView: vi.fn(),
      setViewport: vi.fn(),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>

    const rendered = render(
      <ReactFlowProvider>
        <TestHarness activeSpaceId="space-1" spaces={[ACTIVE_SPACE]} reactFlow={reactFlow} />
      </ReactFlowProvider>,
    )

    // Archiving removes the Space from the store, then the canvas renders without it.
    act(() => {
      replaceWorkspaceSpaces('workspace-1', [])
    })
    rendered.rerender(
      <ReactFlowProvider>
        <TestHarness activeSpaceId={null} spaces={[]} reactFlow={reactFlow} />
      </ReactFlowProvider>,
    )

    await waitFor(() => {
      expect(reactFlow.fitView).not.toHaveBeenCalled()
    })
  })
})
