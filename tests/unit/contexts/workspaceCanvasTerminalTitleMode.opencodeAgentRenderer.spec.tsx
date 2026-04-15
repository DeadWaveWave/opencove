import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
      terminalThemeMode,
    }: {
      title: string
      terminalProvider?: string | null
      terminalThemeMode?: string
    }) => {
      return (
        <div>
          <span data-testid="terminal-title">{title}</span>
          <span data-testid="terminal-provider">{terminalProvider ?? 'none'}</span>
          <span data-testid="terminal-theme-mode">{terminalThemeMode ?? 'sync-with-ui'}</span>
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

describe('WorkspaceCanvas terminal title mode (OpenCode agent renderer)', () => {
  it('keeps opencode agent nodes on the provider-specific renderer path without forcing dark theme', async () => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill: vi.fn(async () => undefined),
          onExit: vi.fn(() => () => undefined),
          spawn: vi.fn(async () => ({ sessionId: 'spawned-session' })),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        agent: {
          launch: vi.fn(async () => ({
            sessionId: 'agent-session',
            provider: 'opencode',
            command: 'opencode',
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
            provider: 'opencode',
            effectiveModel: null,
          })),
        },
      },
    })

    const initialNodes: Node<TerminalNodeData>[] = [
      {
        id: 'agent-opencode-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          sessionId: 'session-opencode-agent',
          title: 'opencode · qwen',
          titlePinnedByUser: false,
          width: 520,
          height: 400,
          kind: 'agent',
          status: 'running',
          startedAt: '2026-03-23T10:00:00.000Z',
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          terminalProviderHint: null,
          agent: {
            provider: 'opencode',
            prompt: 'Investigate theme sync behavior',
            model: 'qwen',
            effectiveModel: 'qwen',
            launchMode: 'new',
            resumeSessionId: 'session-opencode-agent',
            resumeSessionIdVerified: true,
            executionDirectory: '/tmp',
            expectedDirectory: null,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
            taskId: null,
          },
          task: null,
          note: null,
          image: null,
          document: null,
          website: null,
        },
        draggable: true,
        selectable: true,
      },
    ]

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    const spaces: WorkspaceSpaceState[] = []

    render(
      <WorkspaceCanvas
        workspaceId="workspace-opencode-theme"
        workspacePath="/tmp"
        worktreesRoot=""
        nodes={initialNodes}
        onNodesChange={() => undefined}
        spaces={spaces}
        activeSpaceId={null}
        onSpacesChange={() => undefined}
        onActiveSpaceChange={() => undefined}
        viewport={viewport}
        isMinimapVisible={false}
        onViewportChange={() => undefined}
        onMinimapVisibilityChange={() => undefined}
        agentSettings={DEFAULT_AGENT_SETTINGS}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('terminal-provider')).toHaveTextContent('opencode')
    })
    expect(screen.getByTestId('terminal-theme-mode')).toHaveTextContent('sync-with-ui')
  })
})
