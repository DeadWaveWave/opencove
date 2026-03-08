import React, { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceViewport,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'

vi.mock('@xyflow/react', () => {
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      setCenter: vi.fn(),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setViewport: vi.fn(),
    }),
    useStoreApi: () => ({
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      subscribe: vi.fn(),
    }),
    ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
    ReactFlow: ({
      nodes,
      nodeTypes,
    }: {
      nodes: Array<{ id: string; type: string; data: unknown }>
      nodeTypes?: Record<string, React.ComponentType<{ id: string; data: unknown }>>
    }) => {
      return (
        <div>
          {nodes.map(node => {
            const Renderer = nodeTypes?.[node.type]
            if (!Renderer) {
              return null
            }
            return <Renderer key={node.id} id={node.id} data={node.data} />
          })}
        </div>
      )
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    BackgroundVariant: {
      Dots: 'dots',
    },
    SelectionMode: {
      Partial: 'partial',
    },
    MarkerType: {
      ArrowClosed: 'arrowclosed',
    },
    PanOnScrollMode: {
      Free: 'free',
    },
  }
})

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode', () => {
  return {
    TerminalNode: ({ onClose }: { onClose?: () => void }) => {
      return (
        <button type="button" data-testid="agent-close" onClick={() => onClose?.()}>
          Close
        </button>
      )
    },
  }
})

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TaskNode', () => {
  return {
    TaskNode: () => null,
  }
})

describe('WorkspaceCanvas task agent session record', () => {
  it('persists a history record when a linked agent node is closed', async () => {
    const kill = vi.fn(async () => undefined)
    const onExit = vi.fn(() => () => undefined)
    let metadataListener:
      | ((event: { sessionId: string; resumeSessionId: string | null }) => void)
      | null = null

    Object.defineProperty(window, 'coveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill,
          onExit,
          onState: vi.fn(() => () => undefined),
          onMetadata: vi.fn(
            (listener: (event: { sessionId: string; resumeSessionId: string | null }) => void) => {
              metadataListener = listener
              return () => undefined
            },
          ),
        },
        agent: {
          launch: vi.fn(async () => {
            throw new Error('not used')
          }),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        task: {
          suggestTitle: vi.fn(async () => ({
            title: 't',
            provider: 'codex',
            effectiveModel: null,
          })),
        },
      },
    })

    const now = new Date().toISOString()

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'agent-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          sessionId: 'session-agent',
          title: 'codex · model',
          width: 520,
          height: 400,
          kind: 'agent',
          status: 'running',
          startedAt: now,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: {
            provider: 'codex',
            prompt: 'Do something important',
            model: 'gpt-5.2-codex',
            effectiveModel: 'gpt-5.2-codex',
            launchMode: 'new',
            resumeSessionId: 'resume-updated',
            resumeSessionIdVerified: false,
            executionDirectory: '/tmp/repo/.cove/worktrees/demo',
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
            taskId: 'task-1',
          },
          task: null,
          note: null,
        },
        draggable: true,
        selectable: true,
      },
      {
        id: 'task-1',
        type: 'taskNode',
        position: { x: 0, y: 520 },
        data: {
          sessionId: '',
          title: 'Task 1',
          width: 460,
          height: 280,
          kind: 'task',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: null,
          task: {
            requirement: 'Improve retry logic',
            status: 'doing',
            priority: 'medium',
            tags: [],
            linkedAgentNodeId: 'agent-1',
            agentSessions: [],
            lastRunAt: now,
            autoGeneratedTitle: false,
            createdAt: now,
            updatedAt: now,
          },
          note: null,
        },
        draggable: true,
        selectable: true,
      },
    ]

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    const spaces: WorkspaceSpaceState[] = []
    let latestNodes = initialNodes

    function Harness() {
      const [nodes, setNodes] = useState(initialNodes)
      latestNodes = nodes

      return (
        <WorkspaceCanvas
          workspaceId="workspace-1"
          workspacePath="/tmp/repo"
          worktreesRoot=""
          nodes={nodes}
          onNodesChange={setNodes}
          spaces={spaces}
          activeSpaceId={null}
          onSpacesChange={() => undefined}
          onActiveSpaceChange={() => undefined}
          viewport={viewport}
          isMinimapVisible={false}
          onViewportChange={() => undefined}
          onMinimapVisibilityChange={() => undefined}
          agentSettings={DEFAULT_AGENT_SETTINGS}
        />
      )
    }

    render(<Harness />)

    act(() => {
      metadataListener?.({ sessionId: 'session-agent', resumeSessionId: 'resume-updated' })
    })

    fireEvent.click(screen.getByTestId('agent-close'))

    await waitFor(() => {
      expect(kill).toHaveBeenCalledWith({ sessionId: 'session-agent' })
    })

    const taskNode = latestNodes.find(node => node.id === 'task-1')
    expect(taskNode?.data.kind).toBe('task')
    expect(taskNode?.data.task?.linkedAgentNodeId).toBeNull()

    expect(taskNode?.data.task?.agentSessions).toHaveLength(1)
    expect(taskNode?.data.task?.agentSessions[0]).toEqual(
      expect.objectContaining({
        provider: 'codex',
        prompt: 'Do something important',
        resumeSessionId: 'resume-updated',
        resumeSessionIdVerified: true,
        boundDirectory: '/tmp/repo/.cove/worktrees/demo',
        status: 'stopped',
      }),
    )
  })
})
