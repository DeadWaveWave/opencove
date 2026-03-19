import React, { useState } from 'react'
import type { Node } from '@xyflow/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { resolveDefaultTaskWindowSize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import type { SuggestTaskTitleResult } from '../../../src/shared/contracts/dto/task'
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
    TaskNode: ({
      title,
      priority,
      tags,
      isEnriching,
    }: {
      title: string
      priority: string
      tags: string[]
      isEnriching?: boolean
    }) => {
      return (
        <div data-testid="task-node">
          <span data-testid="task-node-title">{title}</span>
          <span data-testid="task-node-priority">{priority}</span>
          <span data-testid="task-node-tags">{tags.join(',')}</span>
          {isEnriching ? <span data-testid="task-node-enrichment" /> : null}
        </div>
      )
    },
  }
})

describe('WorkspaceCanvas task creation async enrichment', () => {
  it('creates the task immediately without triggering AI enrichment when naming is disabled', async () => {
    const suggestTitle = vi.fn(
      async (): Promise<SuggestTaskTitleResult> => ({
        title: 'Auto: Login Retry',
        priority: 'high',
        tags: ['auth'],
        provider: 'codex',
        effectiveModel: 'gpt-5.2-codex',
      }),
    )

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
          launch: vi.fn(async () => {
            throw new Error('not used')
          }),
          resolveResumeSessionId: vi.fn(async () => ({ sessionId: null, source: 'missing' })),
        },
        task: {
          suggestTitle,
        },
      },
    })

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    const spaces: WorkspaceSpaceState[] = []
    const requirement = 'Implement login retry with exponential backoff and jitter'
    const fallbackTitle = `${requirement.replace(/\s+/g, ' ').trim().slice(0, 24)}...`
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
            taskTitleProvider: 'codex',
            taskTitleModel: 'gpt-5.2-codex',
            taskTagOptions: ['auth', 'retry'],
          }}
        />
      )
    }

    render(<Harness />)

    fireEvent.contextMenu(screen.getByTestId('react-flow-pane'), {
      clientX: 320,
      clientY: 220,
    })

    fireEvent.click(await screen.findByTestId('workspace-context-new-task'))
    fireEvent.change(screen.getByTestId('workspace-task-requirement'), {
      target: { value: requirement },
    })
    fireEvent.click(screen.getByTestId('workspace-task-create-submit'))

    await waitFor(() => {
      expect(suggestTitle).not.toHaveBeenCalled()
      expect(screen.queryByTestId('workspace-task-creator')).toBeNull()
      expect(screen.getByTestId('task-node')).toBeInTheDocument()
    })

    expect(screen.getByTestId('task-node-title')).toHaveTextContent(fallbackTitle)
    expect(screen.getByTestId('task-node-priority')).toHaveTextContent('medium')
    expect(screen.getByTestId('task-node-tags')).toHaveTextContent('')
    expect(screen.queryByTestId('task-node-enrichment')).toBeNull()
    const expectedSize = resolveDefaultTaskWindowSize()
    expect(latestNodes).toHaveLength(1)
    expect(latestNodes[0]?.position).toEqual({
      x: 320 - expectedSize.width / 2,
      y: 220 - expectedSize.height / 2,
    })
  })
})
