import React, { useState } from 'react'
import type { Node } from '@xyflow/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { resolveDefaultAgentWindowSize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceViewport,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import { createMountAwareAgentControlSurface } from './workspaceCanvas.mountTestSupport'

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
      onPaneContextMenu,
    }: {
      nodes: Array<{ id: string; type: string; data: unknown }>
      nodeTypes?: Record<string, React.ComponentType<{ id: string; data: unknown }>>
      onPaneContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
    }) => {
      currentNodes = nodes
      return (
        <div>
          <div
            data-testid="react-flow-pane"
            className="react-flow__pane"
            onContextMenu={event => {
              onPaneContextMenu?.(event)
            }}
          />
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
    Handle: () => null,
    Position: {
      Left: 'left',
      Right: 'right',
    },
  }
})

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode', () => {
  return {
    TerminalNode: ({ status, title }: { status?: string | null; title?: string }) => {
      return (
        <div data-testid="agent-node-status">
          {title}:{status ?? 'null'}
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

describe('WorkspaceCanvas run default agent', () => {
  it('launches the default agent directly from the pane context menu with standby initial status', async () => {
    const launchInMount = vi.fn(async () => ({
      sessionId: 'new-session',
      provider: 'codex' as const,
      command: 'codex',
      args: ['--dangerously-bypass-approvals-and-sandbox'],
      launchMode: 'new' as const,
      effectiveModel: 'gpt-5.2-codex',
      resumeSessionId: null,
      profileId: 'wsl:Ubuntu',
      runtimeKind: 'posix' as const,
      startedAt: '2026-05-10T00:00:00.000Z',
      executionContext: {
        projectId: 'workspace-1',
        spaceId: null,
        mountId: 'mount-local',
        targetId: 'target-local',
        workingDirectory: '/tmp/repo',
        target: { rootPath: '/tmp/repo', rootUri: 'file:///tmp/repo' },
        scope: { rootPath: '/tmp/repo', rootUri: 'file:///tmp/repo' },
        endpoint: { endpointId: 'local', kind: 'local' as const },
      },
    }))
    const controlSurfaceInvoke = createMountAwareAgentControlSurface({
      workspaceId: 'workspace-1',
      rootPath: '/tmp/repo',
      launchInMount,
    })

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill: vi.fn(async () => undefined),
          onExit: vi.fn(() => () => undefined),
          onState: vi.fn(() => () => undefined),
          onMetadata: vi.fn(() => () => undefined),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        controlSurface: {
          invoke: controlSurfaceInvoke,
        },
        agent: {
          launch: vi.fn(),
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

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    const spaces: WorkspaceSpaceState[] = []
    let latestNodes: Node<TerminalNodeData>[] = []

    function Harness() {
      const [nodes, setNodes] = useState<Node<TerminalNodeData>[]>([])
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
          agentSettings={{
            ...DEFAULT_AGENT_SETTINGS,
            defaultProvider: 'codex',
            defaultTerminalProfileId: 'wsl:Ubuntu',
            defaultTerminalWindowScalePercent: 120,
            customModelEnabledByProvider: {
              ...DEFAULT_AGENT_SETTINGS.customModelEnabledByProvider,
              codex: true,
            },
            customModelByProvider: {
              ...DEFAULT_AGENT_SETTINGS.customModelByProvider,
              codex: 'gpt-5.2-codex',
            },
            customModelOptionsByProvider: {
              ...DEFAULT_AGENT_SETTINGS.customModelOptionsByProvider,
              codex: ['gpt-5.2-codex'],
            },
            standardWindowSizeBucket: 'large',
          }}
        />
      )
    }

    render(<Harness />)

    fireEvent.contextMenu(screen.getByTestId('react-flow-pane'), {
      clientX: 320,
      clientY: 220,
    })

    fireEvent.click(await screen.findByTestId('workspace-context-run-default-agent'))

    await waitFor(() => {
      expect(launchInMount).toHaveBeenCalledTimes(1)
    })

    expect(controlSurfaceInvoke).toHaveBeenNthCalledWith(1, {
      kind: 'query',
      id: 'mount.list',
      payload: { projectId: 'workspace-1' },
    })
    expect(launchInMount).toHaveBeenCalledWith(
      expect.objectContaining({
        mountId: 'mount-local',
        cwdUri: 'file:///tmp/repo',
        provider: 'codex',
        prompt: '',
        mode: 'new',
        model: 'gpt-5.2-codex',
        cols: expect.any(Number),
        rows: expect.any(Number),
      }),
    )
    await waitFor(() => {
      expect(screen.getByTestId('agent-node-status')).toHaveTextContent(
        'codex · gpt-5.2-codex:standby',
      )
    })
    const expectedSize = resolveDefaultAgentWindowSize('large')
    expect(latestNodes).toHaveLength(1)
    expect(latestNodes[0]?.position).toEqual({
      x: 320 - expectedSize.width / 2,
      y: 220 - expectedSize.height / 2,
    })
    expect(latestNodes[0]?.data.width).toBe(expectedSize.width)
    expect(latestNodes[0]?.data.height).toBe(expectedSize.height)
    expect(screen.queryByTestId('workspace-agent-launcher')).toBeNull()
  })

  it('can expand the pane context menu to launch a specific installed agent CLI', async () => {
    const launchInMount = vi.fn(async () => ({
      sessionId: 'new-session',
      provider: 'claude-code' as const,
      command: 'claude',
      args: ['--model', 'claude-sonnet-4-6'],
      launchMode: 'new' as const,
      effectiveModel: 'claude-sonnet-4-6',
      resumeSessionId: null,
      profileId: null,
      runtimeKind: 'posix' as const,
      startedAt: '2026-05-10T00:00:00.000Z',
      executionContext: {
        projectId: 'workspace-1',
        spaceId: null,
        mountId: 'mount-local',
        targetId: 'target-local',
        workingDirectory: '/tmp/repo',
        target: { rootPath: '/tmp/repo', rootUri: 'file:///tmp/repo' },
        scope: { rootPath: '/tmp/repo', rootUri: 'file:///tmp/repo' },
        endpoint: { endpointId: 'local', kind: 'local' as const },
      },
    }))

    const listInstalledProviders = vi.fn(async () => ({
      providers: ['claude-code' as const],
    }))
    const controlSurfaceInvoke = createMountAwareAgentControlSurface({
      workspaceId: 'workspace-1',
      rootPath: '/tmp/repo',
      launchInMount,
    })

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill: vi.fn(async () => undefined),
          onExit: vi.fn(() => () => undefined),
          onState: vi.fn(() => () => undefined),
          onMetadata: vi.fn(() => () => undefined),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        controlSurface: {
          invoke: controlSurfaceInvoke,
        },
        agent: {
          launch: vi.fn(),
          listInstalledProviders,
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

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    const spaces: WorkspaceSpaceState[] = []

    function Harness() {
      const [nodes, setNodes] = useState<Node<TerminalNodeData>[]>([])

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
          agentSettings={{
            ...DEFAULT_AGENT_SETTINGS,
            defaultProvider: 'codex',
            customModelEnabledByProvider: {
              ...DEFAULT_AGENT_SETTINGS.customModelEnabledByProvider,
              'claude-code': true,
            },
            customModelByProvider: {
              ...DEFAULT_AGENT_SETTINGS.customModelByProvider,
              'claude-code': 'claude-sonnet-4-6',
            },
            customModelOptionsByProvider: {
              ...DEFAULT_AGENT_SETTINGS.customModelOptionsByProvider,
              'claude-code': ['claude-sonnet-4-6'],
            },
          }}
        />
      )
    }

    render(<Harness />)

    fireEvent.contextMenu(screen.getByTestId('react-flow-pane'), {
      clientX: 320,
      clientY: 220,
    })

    fireEvent.click(await screen.findByTestId('workspace-context-run-agent-provider-toggle'))

    fireEvent.click(await screen.findByTestId('workspace-context-run-agent-claude-code'))

    await waitFor(() => {
      expect(listInstalledProviders).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(launchInMount).toHaveBeenCalledTimes(1)
    })

    expect(launchInMount).toHaveBeenCalledWith(
      expect.objectContaining({
        mountId: 'mount-local',
        cwdUri: 'file:///tmp/repo',
        provider: 'claude-code',
        prompt: '',
        mode: 'new',
        model: 'claude-sonnet-4-6',
        cols: expect.any(Number),
        rows: expect.any(Number),
      }),
    )
  })

  it('orders the installed agent submenu based on agent settings', async () => {
    const listInstalledProviders = vi.fn(async () => ({
      providers: ['claude-code' as const, 'codex' as const],
    }))

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill: vi.fn(async () => undefined),
          onExit: vi.fn(() => () => undefined),
          onState: vi.fn(() => () => undefined),
          onMetadata: vi.fn(() => () => undefined),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        agent: {
          launch: vi.fn(async () => ({
            sessionId: 'new-session',
            provider: 'codex' as const,
            command: 'codex',
            args: ['--dangerously-bypass-approvals-and-sandbox'],
            launchMode: 'new' as const,
            effectiveModel: null,
            resumeSessionId: null,
          })),
          listInstalledProviders,
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

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    const spaces: WorkspaceSpaceState[] = []

    function Harness() {
      const [nodes, setNodes] = useState<Node<TerminalNodeData>[]>([])

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
          agentSettings={{
            ...DEFAULT_AGENT_SETTINGS,
            agentProviderOrder: ['codex', 'claude-code', 'opencode', 'gemini'],
          }}
        />
      )
    }

    render(<Harness />)

    fireEvent.contextMenu(screen.getByTestId('react-flow-pane'), {
      clientX: 320,
      clientY: 220,
    })

    fireEvent.click(await screen.findByTestId('workspace-context-run-agent-provider-toggle'))

    const menu = await screen.findByTestId('workspace-context-run-agent-provider-menu')

    const ids = Array.from(menu.querySelectorAll('button')).map(button =>
      button.getAttribute('data-testid'),
    )

    expect(ids).toEqual([
      'workspace-context-run-agent-codex',
      'workspace-context-run-agent-claude-code',
    ])
  })
})
