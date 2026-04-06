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
  let currentNodes: Array<{ id: string; type: string; data: unknown }> = []

  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      setCenter: vi.fn(),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setViewport: vi.fn(),
    }),
    useStore: (selector: (state: unknown) => unknown) => selector({ nodes: currentNodes }),
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
      currentNodes = nodes
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
    TerminalNode: ({
      title,
      terminalProvider,
      onCommandRun,
      onTitleCommit,
    }: {
      title: string
      terminalProvider?: string | null
      onCommandRun?: (command: string) => void
      onTitleCommit?: (title: string) => void
    }) => {
      return (
        <div>
          <span data-testid="terminal-title">{title}</span>
          <span data-testid="terminal-provider">{terminalProvider ?? 'none'}</span>
          <button
            type="button"
            data-testid="terminal-command-auto-1"
            onClick={() => {
              onCommandRun?.('ls -la')
            }}
          >
            Auto 1
          </button>
          <button
            type="button"
            data-testid="terminal-command-auto-2"
            onClick={() => {
              onCommandRun?.('pwd')
            }}
          >
            Auto 2
          </button>
          <button
            type="button"
            data-testid="terminal-command-opencode"
            onClick={() => {
              onCommandRun?.('opencode .')
            }}
          >
            OpenCode
          </button>
          <button
            type="button"
            data-testid="terminal-rename-manual"
            onClick={() => {
              onTitleCommit?.('manual-name')
            }}
          >
            Rename
          </button>
        </div>
      )
    },
  }
})

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TaskNode', () => {
  return {
    TaskNode: () => null,
  }
})

describe('WorkspaceCanvas terminal title mode', () => {
  it('keeps user title after manual rename and ignores later auto command titles', async () => {
    const kill = vi.fn(async () => undefined)
    const onExit = vi.fn(() => () => undefined)

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill,
          onExit,
          spawn: vi.fn(async () => ({ sessionId: 'spawned-session' })),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        agent: {
          launch: vi.fn(async () => ({
            sessionId: 'agent-session',
            provider: 'codex',
            command: 'codex',
            args: [],
            launchMode: 'new',
            effectiveModel: null,
            resumeSessionId: null,
          })),
        },
        task: {
          suggestTitle: vi.fn(async () => ({
            title: 'task-title',
            priority: 'medium',
            tags: [],
            provider: 'codex',
            effectiveModel: null,
          })),
        },
      },
    })

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'terminal-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          sessionId: 'session-1',
          title: 'terminal-1',
          titlePinnedByUser: false,
          width: 520,
          height: 400,
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

    expect(screen.getByTestId('terminal-title')).toHaveTextContent('terminal-1')
    expect(screen.getByTestId('terminal-provider')).toHaveTextContent('none')

    fireEvent.click(screen.getByTestId('terminal-command-auto-1'))

    await waitFor(() => {
      expect(screen.getByTestId('terminal-title')).toHaveTextContent('ls -la')
    })
    expect(latestNodes[0]?.data.titlePinnedByUser).toBe(false)

    fireEvent.click(screen.getByTestId('terminal-rename-manual'))

    await waitFor(() => {
      expect(screen.getByTestId('terminal-title')).toHaveTextContent('manual-name')
    })
    expect(latestNodes[0]?.data.titlePinnedByUser).toBe(true)

    fireEvent.click(screen.getByTestId('terminal-command-auto-2'))

    await waitFor(() => {
      expect(screen.getByTestId('terminal-title')).toHaveTextContent('manual-name')
    })
    expect(latestNodes[0]?.data.title).toBe('manual-name')
  })

  it('tracks opencode command launches as a terminal provider hint', async () => {
    const kill = vi.fn(async () => undefined)
    const onExit = vi.fn(() => () => undefined)

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill,
          onExit,
          spawn: vi.fn(async () => ({ sessionId: 'spawned-session' })),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        agent: {
          launch: vi.fn(async () => ({
            sessionId: 'agent-session',
            provider: 'codex',
            command: 'codex',
            args: [],
            launchMode: 'new',
            effectiveModel: null,
            resumeSessionId: null,
          })),
        },
        task: {
          suggestTitle: vi.fn(async () => ({
            title: 'task-title',
            priority: 'medium',
            tags: [],
            provider: 'codex',
            effectiveModel: null,
          })),
        },
      },
    })

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'terminal-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          sessionId: 'session-1',
          title: 'terminal-1',
          titlePinnedByUser: false,
          width: 520,
          height: 400,
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

    fireEvent.click(screen.getByTestId('terminal-command-opencode'))

    await waitFor(() => {
      expect(screen.getByTestId('terminal-title')).toHaveTextContent('opencode .')
    })
    await waitFor(() => {
      expect(screen.getByTestId('terminal-provider')).toHaveTextContent('opencode')
    })
    expect(latestNodes[0]?.data.terminalProviderHint).toBe('opencode')
  })
})
