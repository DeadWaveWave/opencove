import React, { useState } from 'react'
import type { Node } from '@xyflow/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { resolveDefaultTerminalWindowSize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
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
    TerminalNode: () => null,
  }
})

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TaskNode', () => {
  return {
    TaskNode: () => null,
  }
})

describe('WorkspaceCanvas create terminal standard sizing', () => {
  it('creates pane terminals using the configured standard window size bucket', async () => {
    const spawn = vi.fn(async () => ({
      sessionId: 'terminal-session',
      profileId: 'profile-1',
      runtimeKind: 'process' as const,
    }))

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          spawn,
          kill: vi.fn(async () => undefined),
          onExit: vi.fn(() => () => undefined),
          onState: vi.fn(() => () => undefined),
          onMetadata: vi.fn(() => () => undefined),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
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
            defaultTerminalWindowScalePercent: 120,
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

    fireEvent.click(await screen.findByTestId('workspace-context-new-terminal'))

    await waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1)
    })

    const expectedSize = resolveDefaultTerminalWindowSize('large')
    await waitFor(() => {
      expect(latestNodes).toHaveLength(1)
    })
    expect(latestNodes[0]?.position).toEqual({
      x: 320 - expectedSize.width / 2,
      y: 220 - expectedSize.height / 2,
    })
    expect(latestNodes[0]?.data.width).toBe(expectedSize.width)
    expect(latestNodes[0]?.data.height).toBe(expectedSize.height)
  })
})
