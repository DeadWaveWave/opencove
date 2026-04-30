import React, { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { AgentSessionSummary } from '../../../src/shared/contracts/dto'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceViewport,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'

const SWITCH_SUMMARY: AgentSessionSummary = {
  sessionId: 'resume-target',
  provider: 'codex',
  cwd: '/tmp/repo/.opencove/worktrees/target',
  title: 'Target session',
  startedAt: '2026-04-29T00:20:00.000Z',
  updatedAt: '2026-04-29T00:30:00.000Z',
  source: 'codex-file',
}

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
      onSwitchSession,
    }: {
      onSwitchSession?: (summary: AgentSessionSummary) => Promise<void>
    }) => {
      return (
        <button
          type="button"
          data-testid="agent-switch"
          onClick={() => {
            void onSwitchSession?.(SWITCH_SUMMARY)
          }}
        >
          Switch
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

function createLaunchResult(sessionId: string, resumeSessionId: string | null) {
  return {
    sessionId,
    provider: 'codex' as const,
    command: 'codex',
    args: [],
    launchMode: resumeSessionId ? ('resume' as const) : ('new' as const),
    effectiveModel: 'gpt-5.2-codex',
    resumeSessionId,
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

describe('WorkspaceCanvas agent session switch', () => {
  it('switches the current agent node in place and archives the previous task binding', async () => {
    const kill = vi.fn(async () => undefined)
    const launch = vi.fn(async () => createLaunchResult('session-switched', 'resume-target'))
    const requestPersistFlush = vi.fn()

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
      },
    })

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    const spaces: WorkspaceSpaceState[] = []
    let latestNodes = createInitialNodes()

    function Harness() {
      const [nodes, setNodes] = useState(createInitialNodes())
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
    fireEvent.click(screen.getByTestId('agent-switch'))

    await waitFor(() => {
      expect(kill).toHaveBeenCalledWith({ sessionId: 'session-current-pty' })
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/tmp/repo/.opencove/worktrees/target',
          mode: 'resume',
          resumeSessionId: 'resume-target',
        }),
      )
    })

    await waitFor(() => {
      const agentNode = latestNodes.find(node => node.id === 'agent-1')
      const taskNode = latestNodes.find(node => node.id === 'task-1')

      expect(agentNode?.data.sessionId).toBe('session-switched')
      expect(agentNode?.data.startedAt).toBe('2026-04-29T00:20:00.000Z')
      expect(agentNode?.data.agent?.resumeSessionId).toBe('resume-target')
      expect(agentNode?.data.agent?.resumeSessionIdVerified).toBe(true)
      expect(agentNode?.data.agent?.executionDirectory).toBe('/tmp/repo/.opencove/worktrees/target')
      expect(agentNode?.data.agent?.expectedDirectory).toBe('/tmp/repo/.opencove/worktrees/target')
      expect(taskNode?.data.task?.linkedAgentNodeId).toBe('agent-1')
      expect(requestPersistFlush).toHaveBeenCalledTimes(2)
      expect(taskNode?.data.task?.agentSessions[0]).toEqual(
        expect.objectContaining({
          resumeSessionId: 'resume-current',
          resumeSessionIdVerified: true,
          boundDirectory: '/tmp/repo',
          status: 'stopped',
        }),
      )
    })
  })

  it('preserves the current binding when switch relaunch fails', async () => {
    const kill = vi.fn(async () => undefined)
    const launch = vi.fn(async () => {
      throw new Error('switch failed')
    })

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
      },
    })

    const viewport: WorkspaceViewport = { x: 0, y: 0, zoom: 1 }
    const spaces: WorkspaceSpaceState[] = []
    let latestNodes = createInitialNodes()

    function Harness() {
      const [nodes, setNodes] = useState(createInitialNodes())
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
    fireEvent.click(screen.getByTestId('agent-switch'))

    await waitFor(() => {
      const agentNode = latestNodes.find(node => node.id === 'agent-1')
      expect(agentNode?.data.status).toBe('failed')
      expect(agentNode?.data.agent?.resumeSessionId).toBe('resume-current')
      expect(agentNode?.data.agent?.resumeSessionIdVerified).toBe(true)
      expect(agentNode?.data.agent?.executionDirectory).toBe('/tmp/repo')
    })
  })
})
