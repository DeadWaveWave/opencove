import React, { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
        <div>
          <button type="button" data-testid="terminal-close" onClick={() => onClose?.()}>
            Close
          </button>
        </div>
      )
    },
  }
})

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TaskNode', () => {
  return {
    TaskNode: ({ onRunAgent }: { onRunAgent?: () => void }) => {
      return (
        <button type="button" data-testid="task-run-agent" onClick={() => onRunAgent?.()}>
          Run Agent
        </button>
      )
    },
  }
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('WorkspaceCanvas agent launch guard', () => {
  it('kills launched PTY when agent node is closed during an in-flight rerun', async () => {
    const deferred = createDeferred<{
      sessionId: string
      provider: 'codex'
      command: string
      args: string[]
      launchMode: 'new'
      effectiveModel: string | null
      resumeSessionId: string | null
    }>()

    const kill = vi.fn(async () => undefined)
    const launch = vi.fn(() => deferred.promise)
    const onExit = vi.fn(() => () => undefined)

    Object.defineProperty(window, 'coveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill,
          onExit,
          spawn: vi.fn(async () => ({ sessionId: 'spawned' })),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        agent: {
          launch,
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

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'agent-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          sessionId: 'old-session',
          title: 'codex · model',
          width: 520,
          height: 400,
          kind: 'agent',
          status: 'running',
          startedAt: new Date().toISOString(),
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: {
            provider: 'codex',
            prompt: 'do something',
            model: null,
            effectiveModel: null,
            launchMode: 'new',
            resumeSessionId: null,
            executionDirectory: '/tmp',
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
            taskId: null,
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
            status: 'todo',
            priority: 'medium',
            tags: [],
            linkedAgentNodeId: 'agent-1',
            lastRunAt: null,
            autoGeneratedTitle: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
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
          workspacePath="/tmp"
          worktreesRoot=""
          nodes={nodes}
          onNodesChange={next => {
            latestNodes = next
            setNodes(next)
          }}
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

    fireEvent.click(screen.getByTestId('task-run-agent'))

    await waitFor(() => {
      expect(kill).toHaveBeenCalledWith({ sessionId: 'old-session' })
      expect(launch).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByTestId('terminal-close'))

    deferred.resolve({
      sessionId: 'new-session',
      provider: 'codex',
      command: 'codex',
      args: [],
      launchMode: 'new',
      effectiveModel: 'model',
      resumeSessionId: null,
    })

    await waitFor(() => {
      expect(kill).toHaveBeenCalledWith({ sessionId: 'new-session' })
    })

    const agentNode = latestNodes.find(node => node.id === 'agent-1')
    expect(agentNode).toBeUndefined()
  })

  it('clears stale resume binding when rerunning a linked agent as new', async () => {
    const deferred = createDeferred<{
      sessionId: string
      provider: 'codex'
      command: string
      args: string[]
      launchMode: 'new'
      effectiveModel: string | null
      resumeSessionId: string | null
    }>()

    const kill = vi.fn(async () => undefined)
    const launch = vi.fn(() => deferred.promise)
    const onExit = vi.fn(() => () => undefined)

    Object.defineProperty(window, 'coveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill,
          onExit,
          spawn: vi.fn(async () => ({ sessionId: 'spawned' })),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        agent: {
          launch,
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

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'agent-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          sessionId: 'old-session',
          title: 'codex · model',
          width: 520,
          height: 400,
          kind: 'agent',
          status: 'standby',
          startedAt: new Date().toISOString(),
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: {
            provider: 'codex',
            prompt: 'do something',
            model: null,
            effectiveModel: null,
            launchMode: 'resume',
            resumeSessionId: 'stale-session-id',
            resumeSessionIdVerified: true,
            executionDirectory: '/tmp',
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
            status: 'todo',
            priority: 'medium',
            tags: [],
            linkedAgentNodeId: 'agent-1',
            agentSessions: [],
            lastRunAt: null,
            autoGeneratedTitle: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
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
          workspacePath="/tmp"
          worktreesRoot=""
          nodes={nodes}
          onNodesChange={next => {
            latestNodes = next
            setNodes(next)
          }}
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

    fireEvent.click(screen.getByTestId('task-run-agent'))

    await waitFor(() => {
      expect(kill).toHaveBeenCalledWith({ sessionId: 'old-session' })
      expect(launch).toHaveBeenCalledTimes(1)
    })

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'new',
        resumeSessionId: null,
      }),
    )

    await waitFor(() => {
      const agentNode = latestNodes.find(node => node.id === 'agent-1')
      expect(agentNode?.data.agent?.resumeSessionId).toBeNull()
      expect(agentNode?.data.agent?.resumeSessionIdVerified).toBe(false)
    })

    deferred.resolve({
      sessionId: 'new-session',
      provider: 'codex',
      command: 'codex',
      args: [],
      launchMode: 'new',
      effectiveModel: 'model',
      resumeSessionId: null,
    })

    await waitFor(() => {
      const agentNode = latestNodes.find(node => node.id === 'agent-1')
      expect(agentNode?.data.sessionId).toBe('new-session')
      expect(agentNode?.data.agent?.resumeSessionId).toBeNull()
      expect(agentNode?.data.agent?.resumeSessionIdVerified).toBe(false)
    })
  })
})
