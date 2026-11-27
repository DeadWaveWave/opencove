import type { Node } from '@xyflow/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  CREATED,
  TARGET,
  expectsEveryAssignedNodeInTheDocument,
  lastCall,
  recordAssignmentsAgainst,
} from '../../support/pushAwayCallerHarness'
import { createStoreBackedChannels } from '../../support/workspaceCanvasStoreHarness'

// The callers of the push-away whose creators `spaceAssignment.callers.spec.tsx` cannot reach through
// a hook: the pane terminal and the three call sites of the task agent. They run for real against
// a store-backed document. The creator of the node store adds the node to the document before it
// returns it, and the mocked push-away records what the document held when it was called: the
// recipe takes the node from the document (#758), so a caller that assigns before its creator wrote
// the node would assign nothing.

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    assignNodeToSpaceAndExpand: vi.fn(),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared',
  () => ({
    buildMergedAgentLaunchEnv: vi.fn(() => ({})),
    resolveAgentExecutableOverride: vi.fn(() => undefined),
    resolveWorkspaceAgentLaunchBinding: vi.fn(async () => ({
      mountId: null,
      executionDirectory: '/repo',
    })),
    launchWorkspaceAgentSession: vi.fn(async () => ({
      sessionId: 'session',
      profileId: null,
      runtimeKind: 'posix',
      workerBinding: null,
      effectiveModel: null,
      executionDirectory: '/repo',
      resumeSessionId: null,
    })),
  }),
)

const metrics = { fontSize: 13 }
const assignMock = assignNodeToSpaceAndExpand as unknown as Mock
const assignArgs = () => lastCall(assignMock)[0] as Record<string, unknown> | undefined

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the push-away of the pane terminal', () => {
  it('assigns the terminal after its creator wrote the node to the document', async () => {
    const { createTerminalNodeAtFlowPosition: createTerminal } = await vi.importActual<
      typeof import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation')
    >(
      '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation',
    )
    const api = window as unknown as { opencoveApi?: Record<string, unknown> }
    api.opencoveApi = {
      pty: {
        spawn: vi.fn(async () => ({ sessionId: 'session', profileId: null, runtimeKind: 'posix' })),
      },
    }
    const channels = createStoreBackedChannels({ workspaceId: 'workspace', spaces: [TARGET] })
    recordAssignmentsAgainst(assignMock, channels.readDocument)

    const result = await createTerminal({
      anchor: { x: 400, y: 300 },
      workspaceId: 'workspace',
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      workspacePath: '/repo',
      readDocument: channels.readDocument,
      updateCanvasDocument: vi.fn(),
      updateSpaces: vi.fn(),
      createNodeForSession: vi.fn(async () => {
        const created = { ...CREATED, id: 'terminal' } as Node<TerminalNodeData>
        channels.setNodes(previous => [...previous, created])
        return created
      }),
    })

    expect(result).toEqual({ sessionId: 'session', nodeId: 'terminal' })
    expect(assignMock).toHaveBeenCalledTimes(1)
    expectsEveryAssignedNodeInTheDocument(assignMock)
    expect(assignArgs()).toMatchObject({ createdNodeId: 'terminal', targetSpaceId: 'target' })
  })
})

// The task agent's three call sites run for real here (the module that holds them is mocked
// above), against a store-backed document. The creator of the node store adds the node to the
// document before it returns it, and the mocked push-away records what the document held when
// it was called (#758).
describe('the push-away of the task agent', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const session = {
    id: 'record-1',
    provider: 'codex',
    resumeSessionId: 'recorded-session',
    resumeSessionIdVerified: true,
    prompt: 'Implement feature',
    model: null,
    effectiveModel: null,
    boundDirectory: '/repo',
    lastDirectory: '/repo',
    createdAt: now,
    lastRunAt: now,
    endedAt: null,
    exitCode: null,
    status: 'exited',
  }
  const taskWith = (linkedAgentNodeId: string | null) =>
    ({
      id: 'task',
      position: { x: 0, y: 0 },
      data: {
        kind: 'task',
        title: 'Task',
        width: 460,
        height: 280,
        sessionId: '',
        status: null,
        agent: null,
        task: {
          requirement: 'Implement feature',
          status: 'todo',
          priority: 'medium',
          tags: [],
          linkedAgentNodeId,
          agentSessions: [session],
          lastRunAt: null,
          autoGeneratedTitle: false,
          createdAt: now,
          updatedAt: now,
        },
      },
    }) as unknown as Node<TerminalNodeData>
  const linkedAgent = {
    id: 'linked',
    position: { x: 500, y: 0 },
    data: {
      kind: 'agent',
      title: 'Agent',
      width: 520,
      height: 400,
      sessionId: 'linked-session',
      status: 'running',
      agent: {
        provider: 'codex',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: null,
        resumeSessionIdVerified: false,
        executionDirectory: '/repo',
        expectedDirectory: '/repo',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: 'task',
      },
    },
  } as unknown as Node<TerminalNodeData>

  function taskContext(nodes: Node<TerminalNodeData>[]) {
    const channels = createStoreBackedChannels({
      workspaceId: 'workspace',
      nodes,
      spaces: [{ ...TARGET, nodeIds: ['task'] }],
    })
    recordAssignmentsAgainst(assignMock, channels.readDocument)
    return {
      readDocument: channels.readDocument,
      updateCanvasDocument: vi.fn(),
      updateSpaces: vi.fn(),
      updateNodes: channels.setNodes,
      createNodeForSession: vi.fn(async () => {
        const created = { ...CREATED, id: 'agent' } as Node<TerminalNodeData>
        channels.setNodes(previous => [...previous, created])
        return created
      }),
      buildAgentNodeTitle: () => 'Agent',
      launchAgentInNode: vi.fn(async () => undefined),
      agentSettings: DEFAULT_AGENT_SETTINGS,
      workspaceId: 'workspace',
      workspacePath: '/repo',
      terminalDisplayMetrics: metrics,
      t: (key: string) => key,
    } as never
  }

  it('runs a new agent for the task after its creator wrote the node', async () => {
    const { runTaskAgentAction: run } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.run')
    await run('task', taskContext([taskWith(null)]))

    expect(assignMock).toHaveBeenCalledTimes(1)
    expectsEveryAssignedNodeInTheDocument(assignMock)
    expect(assignArgs()).toMatchObject({ createdNodeId: 'agent', targetSpaceId: 'target' })
  })

  it('reuses the linked agent, which the document already holds', async () => {
    const { runTaskAgentAction: run } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.run')
    await run('task', taskContext([taskWith('linked'), linkedAgent]))

    expect(assignMock).toHaveBeenCalledTimes(1)
    expectsEveryAssignedNodeInTheDocument(assignMock)
    expect(assignArgs()).toMatchObject({ createdNodeId: 'linked', targetSpaceId: 'target' })
  })

  it('resumes an agent for the task after its creator wrote the node', async () => {
    const { resumeTaskAgentSessionAction: resume } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.resume')
    await resume('task', 'record-1', taskContext([taskWith(null)]))

    expect(assignMock).toHaveBeenCalledTimes(1)
    expectsEveryAssignedNodeInTheDocument(assignMock)
    expect(assignArgs()).toMatchObject({ createdNodeId: 'agent', targetSpaceId: 'target' })
  })
})
