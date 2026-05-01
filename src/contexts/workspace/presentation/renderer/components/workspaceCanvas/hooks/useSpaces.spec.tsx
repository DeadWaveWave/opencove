import React, { useRef, useState } from 'react'
import { render, waitFor } from '@testing-library/react'
import { ReactFlowProvider, type Node, type ReactFlowInstance } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ContextMenuState, EmptySelectionPromptState } from '../types'
import { useWorkspaceCanvasSpaces } from './useSpaces'

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

function TestHarness({
  activeSpaceId,
  spaces,
  reactFlow,
}: {
  activeSpaceId: string | null
  spaces: WorkspaceSpaceState[]
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
}): React.JSX.Element {
  const nodesRef = useRef([NODE])
  const spacesRef = useRef(spaces)
  const selectedNodeIdsRef = useRef<string[]>([])
  const [, setContextMenu] = useState<ContextMenuState | null>(null)
  const [, setEmptySelectionPrompt] = useState<EmptySelectionPromptState | null>(null)

  useWorkspaceCanvasSpaces({
    workspaceId: 'workspace-1',
    activeSpaceId,
    onActiveSpaceChange: vi.fn(),
    workspacePath: '/tmp/workspace',
    focusNodeTargetZoom: 1,
    standardWindowSizeBucket: 'regular',
    reactFlow,
    nodes: [NODE],
    nodesRef,
    setNodes: vi.fn(),
    spaces,
    spacesRef,
    selectedNodeIds: [],
    selectedNodeIdsRef,
    onSpacesChange: vi.fn(),
    setContextMenu,
    setEmptySelectionPrompt,
  })

  return <div />
}

describe('useWorkspaceCanvasSpaces', () => {
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
