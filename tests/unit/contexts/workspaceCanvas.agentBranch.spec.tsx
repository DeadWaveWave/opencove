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
import { TerminalNodeAgentSessionActions } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeAgentSessionActions'

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
    Handle: () => null,
    Position: {
      Left: 'left',
      Right: 'right',
    },
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
      onBranchSession,
    }: {
      onBranchSession?: () => Promise<void>
    }) => {
      return (
        <button
          type="button"
          data-testid="agent-branch"
          onClick={() => {
            void onBranchSession?.()
          }}
        >
          Branch
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

const placementOverride = vi.hoisted<{
  next: { placement: { x: number; y: number }; canPlace: boolean } | null
}>(() => ({ next: null }))

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.resolvePlacement',
  async importOriginal => {
    const original = await importOriginal<
      typeof import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.resolvePlacement')
    >()

    return {
      ...original,
      resolveNodesPlacement: (input: Parameters<typeof original.resolveNodesPlacement>[0]) => {
        const override = placementOverride.next
        placementOverride.next = null
        return override ?? original.resolveNodesPlacement(input)
      },
    }
  },
)

function createLaunchResult(sessionId: string, resumeSessionId: string | null) {
  return {
    sessionId,
    provider: 'codex' as const,
    command: 'codex',
    args: [],
    launchMode: resumeSessionId ? ('resume' as const) : ('new' as const),
    effectiveModel: 'gpt-5.2-codex',
    resumeSessionId,
    executionDirectory: '/tmp/repo',
    startedAt: '2026-04-29T00:10:00.000Z',
  }
}

function createInitialNodes(): Node<TerminalNodeData>[] {
  const now = '2026-04-29T00:00:00.000Z'

  return [
    {
      id: 'agent-1',
      type: 'terminalNode',
      position: { x: 0, y: 0 },
      data: {
        sessionId: 'session-current-pty',
        title: 'codex · model',
        width: 520,
        height: 400,
        kind: 'agent',
        status: 'standby',
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
          launchMode: 'resume',
          resumeSessionId: 'resume-current',
          resumeSessionIdVerified: true,
          executionDirectory: '/tmp/repo',
          expectedDirectory: '/tmp/repo',
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: 'task-1',
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
        image: null,
        document: null,
        website: null,
      },
      draggable: true,
      selectable: true,
    },
  ]
}

function createInitialSpaces(): WorkspaceSpaceState[] {
  return [
    {
      id: 'space-1',
      name: 'Main',
      directoryPath: '/tmp/repo',
      targetMountId: null,
      labelColor: null,
      nodeIds: ['agent-1', 'task-1'],
      rect: null,
    },
  ]
}

describe('WorkspaceCanvas agent branch', () => {
  it('creates a resumed branch agent and preserves source task binding', async () => {
    const kill = vi.fn(async () => undefined)
    const launch = vi.fn(async () => createLaunchResult('session-branched', 'resume-current'))
    const requestPersistFlush = vi.fn()
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('branch-agent-1')

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill,
          onExit: vi.fn(() => () => undefined),
          spawn: vi.fn(async () => ({ sessionId: 'spawned' })),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        agent: {
          launch,
          listSessions: vi.fn(async () => ({ provider: 'codex', cwd: '/tmp/repo', sessions: [] })),
        },
        task: {
          suggestTitle: vi.fn(async () => ({
            title: 't',
            provider: 'codex',
            effectiveModel: null,
          })),
        },
        meta: {
          isTest: true,
        },
      },
    })

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    let latestNodes = createInitialNodes()
    let latestSpaces = createInitialSpaces()

    function Harness() {
      const [nodes, setNodes] = useState(createInitialNodes())
      const [spaces, setSpaces] = useState(createInitialSpaces())
      latestNodes = nodes
      latestSpaces = spaces

      return (
        <WorkspaceCanvas
          workspaceId="workspace-1"
          workspacePath="/tmp/repo"
          worktreesRoot=""
          nodes={nodes}
          onNodesChange={setNodes}
          onRequestPersistFlush={requestPersistFlush}
          spaces={spaces}
          activeSpaceId={null}
          onSpacesChange={setSpaces}
          onActiveSpaceChange={() => undefined}
          onAppendSpaceArchiveRecord={() => undefined}
          viewport={viewport}
          isMinimapVisible={false}
          onViewportChange={() => undefined}
          onMinimapVisibilityChange={() => undefined}
          agentSettings={DEFAULT_AGENT_SETTINGS}
        />
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByTestId('agent-branch'))

    await waitFor(() => {
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/tmp/repo',
          mode: 'resume',
          resumeSessionId: 'resume-current',
        }),
      )
    })

    await waitFor(() => {
      const agentNodes = latestNodes.filter(node => node.data.kind === 'agent')
      const sourceNode = latestNodes.find(node => node.id === 'agent-1')
      const branchNode = latestNodes.find(node => node.id === 'branch-agent-1')
      const taskNode = latestNodes.find(node => node.id === 'task-1')

      expect(agentNodes).toHaveLength(2)
      expect(sourceNode?.data.sessionId).toBe('session-current-pty')
      expect(sourceNode?.data.agent?.resumeSessionId).toBe('resume-current')
      expect(branchNode?.data.sessionId).toBe('session-branched')
      expect(branchNode?.data.agent).toEqual(
        expect.objectContaining({
          provider: 'codex',
          prompt: 'Do something important',
          model: 'gpt-5.2-codex',
          effectiveModel: 'gpt-5.2-codex',
          executionDirectory: '/tmp/repo',
          expectedDirectory: '/tmp/repo',
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          launchMode: 'resume',
          resumeSessionId: 'resume-current',
          resumeSessionIdVerified: true,
          taskId: 'task-1',
        }),
      )
      expect(taskNode?.data.task?.linkedAgentNodeId).toBe('agent-1')
      expect(latestSpaces[0].nodeIds).toEqual(['agent-1', 'task-1', 'branch-agent-1'])
      expect(requestPersistFlush).toHaveBeenCalled()
    })

    expect(kill).not.toHaveBeenCalledWith({ sessionId: 'session-current-pty' })
    randomUUID.mockRestore()
  })

  it('does not kill an empty session or launch an agent when branch placement fails', async () => {
    const kill = vi.fn(async () => undefined)
    const launch = vi.fn(async () => createLaunchResult('session-should-not-launch', 'resume-current'))
    const requestPersistFlush = vi.fn()

    placementOverride.next = { placement: { x: 0, y: 0 }, canPlace: false }

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          kill,
          onExit: vi.fn(() => () => undefined),
          spawn: vi.fn(async () => ({ sessionId: 'spawned' })),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
        agent: {
          launch,
          listSessions: vi.fn(async () => ({ provider: 'codex', cwd: '/tmp/repo', sessions: [] })),
        },
        task: {
          suggestTitle: vi.fn(async () => ({
            title: 't',
            provider: 'codex',
            effectiveModel: null,
          })),
        },
        meta: {
          isTest: true,
        },
      },
    })

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    let latestNodes = createInitialNodes()

    function Harness() {
      const [nodes, setNodes] = useState(createInitialNodes())
      const [spaces, setSpaces] = useState(createInitialSpaces())
      latestNodes = nodes

      return (
        <WorkspaceCanvas
          workspaceId="workspace-1"
          workspacePath="/tmp/repo"
          worktreesRoot=""
          nodes={nodes}
          onNodesChange={setNodes}
          onRequestPersistFlush={requestPersistFlush}
          spaces={spaces}
          activeSpaceId={null}
          onSpacesChange={setSpaces}
          onActiveSpaceChange={() => undefined}
          onAppendSpaceArchiveRecord={() => undefined}
          viewport={viewport}
          isMinimapVisible={false}
          onViewportChange={() => undefined}
          onMinimapVisibilityChange={() => undefined}
          agentSettings={DEFAULT_AGENT_SETTINGS}
        />
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByTestId('agent-branch'))

    await waitFor(() => {
      expect(kill).not.toHaveBeenCalledWith({ sessionId: '' })
      expect(launch).not.toHaveBeenCalled()
      expect(latestNodes.filter(node => node.data.kind === 'agent')).toHaveLength(1)
    })
  })

  it('disables the Branch session button until the current resume session is verified', () => {
    render(
      <TerminalNodeAgentSessionActions
        status="standby"
        currentDirectory="/tmp/repo"
        currentResumeSessionId="resume-current"
        currentResumeSessionIdVerified={false}
        onBranchSession={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.getByTestId('terminal-node-branch-session')).toBeDisabled()
  })
})
