import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceViewport,
} from '../../../src/contexts/workspace/presentation/renderer/types'

let latestReactFlowProps: Record<string, unknown> = {}

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
    ReactFlow: (props: Record<string, unknown>) => {
      latestReactFlowProps = props
      return <div data-testid="workspace-react-flow" />
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
    TerminalNode: () => null,
  }
})

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TaskNode', () => {
  return {
    TaskNode: () => null,
  }
})

describe('WorkspaceCanvas keyboard focus behavior', () => {
  it('disables built-in React Flow shift selection shortcuts', async () => {
    Object.defineProperty(window, 'coveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          onExit: vi.fn(() => () => undefined),
          spawn: vi.fn(async () => ({ sessionId: 'spawned-session' })),
        },
      },
    })

    latestReactFlowProps = {}

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    const spaces: WorkspaceSpaceState[] = []
    const nodes: Node<TerminalNodeData>[] = []

    render(
      <WorkspaceCanvas
        workspaceId="workspace-1"
        workspacePath="/tmp"
        worktreesRoot=""
        nodes={nodes}
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

    expect(latestReactFlowProps.selectionKeyCode).toBeNull()
    expect(latestReactFlowProps.multiSelectionKeyCode).toBeNull()
  })
})
