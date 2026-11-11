import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  runRoleNodeAction,
  type RoleRunActionContext,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions.run'
import { runTaskAgentAction } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.run'
import type { TaskActionContext } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.shared'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { readManagedClaudeExecutionContext } from '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeLifecycle'
import {
  launchWorkspaceAgentSession,
  resolveWorkspaceAgentLaunchBinding,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeLifecycle',
  () => ({ readManagedClaudeExecutionContext: vi.fn() }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared',
  () => ({
    buildMergedAgentLaunchEnv: () => ({}),
    resolveAgentExecutableOverride: () => null,
    launchWorkspaceAgentSession: vi.fn(),
    resolveWorkspaceAgentLaunchBinding: vi.fn(),
  }),
)
const tuple = { resumeSessionId: 'committed', resumeSessionIdVerified: true }
const receipt = {
  commitRevision: null,
  binding: {
    nodeId: 'new-agent',
    activationId: 'owned',
    runtimeSessionId: 'runtime',
    tuple,
    nodeSeen: false,
    bindingRevision: 0,
    observedRevision: 0,
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readManagedClaudeExecutionContext).mockResolvedValue({
    executionDirectory: '/repo',
    binding: {
      nodeId: 'agent',
      activationId: 'owned',
      runtimeSessionId: 'runtime',
      tuple,
      nodeSeen: true,
      bindingRevision: 2,
      observedRevision: 2,
    },
  })
  vi.mocked(resolveWorkspaceAgentLaunchBinding).mockResolvedValue({
    mountId: null,
    executionDirectory: '/repo',
  })
})
function taskContext(): TaskActionContext {
  const context = {
    nodesRef: {
      current: [
        {
          id: 'task',
          position: { x: 0, y: 0 },
          data: {
            kind: 'task',
            title: 'Task',
            width: 300,
            height: 200,
            task: { requirement: 'Next task', linkedAgentNodeId: 'agent' },
          },
        },
        {
          id: 'agent',
          data: {
            kind: 'agent',
            title: 'Agent',
            agent: {
              provider: 'claude-code',
              prompt: 'Previous task',
              executionDirectory: '/repo',
              expectedDirectory: '/repo',
              directoryMode: 'workspace',
              ...tuple,
            },
          },
        },
      ],
    },
    spacesRef: { current: [] },
    workspaceId: 'workspace',
    workspacePath: '/repo',
    agentSettings: DEFAULT_AGENT_SETTINGS,
    onSpacesChange: vi.fn(),
    onRequestPersistFlush: vi.fn(),
    launchAgentInNode: vi.fn(async () => {}),
    buildAgentNodeTitle: () => 'Agent',
    t: (key: string) => key,
  } as unknown as TaskActionContext
  context.setNodes = updater => {
    context.nodesRef.current = updater(context.nodesRef.current)
  }
  return context
}
describe('managed Claude task and role actions', () => {
  it('task reuse preserves its committed tuple and directory before a failing launch', async () => {
    const context = taskContext()
    vi.mocked(context.launchAgentInNode).mockRejectedValueOnce(new Error('preparation failed'))
    await expect(runTaskAgentAction('task', context)).rejects.toThrow('preparation failed')
    expect(context.nodesRef.current[1].data.agent).toMatchObject({
      ...tuple,
      executionDirectory: '/repo',
    })
    expect(context.onRequestPersistFlush).toHaveBeenCalledTimes(1)
  })
  it('refuses task reuse in a different directory before flush or launch', async () => {
    const context = taskContext()
    vi.mocked(resolveWorkspaceAgentLaunchBinding).mockResolvedValue({
      mountId: null,
      executionDirectory: '/other',
    })
    await runTaskAgentAction('task', context)
    expect(context.onRequestPersistFlush).not.toHaveBeenCalled()
    expect(context.launchAgentInNode).not.toHaveBeenCalled()
    expect(context.nodesRef.current[1].data.agent).toMatchObject({
      ...tuple,
      executionDirectory: '/repo',
    })
  })
  it('role launch uses one fresh agent identity and retains role provenance', async () => {
    vi.mocked(launchWorkspaceAgentSession).mockResolvedValue({
      sessionId: 'runtime',
      managedClaudeLifecycle: receipt,
      resumeSessionId: 'committed',
      profileId: null,
      runtimeKind: 'posix',
      effectiveModel: null,
      executionDirectory: '/repo',
      workerBinding: { endpointId: 'local', mountId: null },
    })
    const createNodeForSession = vi.fn(async input => ({
      id: input.nodeId,
      data: { width: 600, height: 400 },
      position: { x: 400, y: 0 },
    }))
    const context = {
      workspaceId: 'workspace',
      workspacePath: '/repo',
      agentSettings: DEFAULT_AGENT_SETTINGS,
      nodesRef: {
        current: [
          {
            id: 'role-node',
            position: { x: 0, y: 0 },
            data: {
              kind: 'role',
              width: 300,
              role: { roleId: 'reviewer', input: '', selectedProvider: 'claude-code' },
            },
          },
        ],
      },
      spacesRef: { current: [] },
      projectRoles: [
        { id: 'reviewer', name: 'Reviewer', promptTemplate: 'Review the task', outputFormat: '' },
      ],
      createNodeForSession,
      appendRoleRunRecord: vi.fn(),
      setNodes: vi.fn(),
      onSpacesChange: vi.fn(),
      onRequestPersistFlush: vi.fn(),
      updateRoleInput: vi.fn(),
      buildAgentNodeTitle: () => 'Reviewer',
      t: (key: string) => key,
    } as unknown as RoleRunActionContext
    await runRoleNodeAction('role-node', undefined, context)
    const launchInput = vi.mocked(launchWorkspaceAgentSession).mock.calls[0][0]
    expect(launchInput.canvasNodeId).not.toBe('role-node')
    expect(createNodeForSession).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: launchInput.canvasNodeId,
        managedClaudeLifecycle: receipt,
      }),
    )
    expect(context.appendRoleRunRecord).toHaveBeenCalledWith(
      'role-node',
      expect.objectContaining({
        linkedAgentNodeId: launchInput.canvasNodeId,
        record: expect.objectContaining({ agentNodeId: launchInput.canvasNodeId }),
      }),
    )
  })
})

it('task history records the effective committed tuple returned by a managed resume', async () => {
  const { resumeTaskAgentSessionAction } =
    await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.resume')
  const context = taskContext()
  const task = context.nodesRef.current[0]
  task.position = { x: 0, y: 0 }
  task.data.width = 300
  task.data.task = {
    ...task.data.task!,
    linkedAgentNodeId: null,
    agentSessions: [
      {
        id: 'history',
        provider: 'claude-code',
        prompt: 'Resume saved task',
        model: null,
        boundDirectory: '/repo',
        resumeSessionId: 'cached-a',
        resumeSessionIdVerified: true,
      } as never,
    ],
  }
  context.terminalDisplayMetrics = { fontSize: 13 }
  const binding = {
    nodeId: 'new-agent',
    activationId: 'activated',
    runtimeSessionId: 'runtime',
    tuple,
    nodeSeen: false,
    bindingRevision: 0,
    observedRevision: 0,
  }
  vi.mocked(launchWorkspaceAgentSession).mockResolvedValue({
    sessionId: 'runtime',
    resumeSessionId: tuple.resumeSessionId,
    profileId: null,
    runtimeKind: 'posix',
    effectiveModel: null,
    executionDirectory: '/repo',
    workerBinding: { endpointId: 'local', mountId: null },
    managedClaudeLifecycle: { binding, commitRevision: null },
  })
  context.createNodeForSession = vi.fn(async input => ({
    id: input.nodeId!,
    position: { x: 0, y: 0 },
    data: { ...task.data, kind: 'agent', agent: input.agent!, task: null },
  }))
  await resumeTaskAgentSessionAction('task', 'history', context)
  expect(context.createNodeForSession).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: expect.objectContaining(tuple),
      managedClaudeLifecycle: { binding, commitRevision: null },
    }),
  )
  expect(context.nodesRef.current[0].data.task?.agentSessions?.[0]).toMatchObject(tuple)
})

it('carries the task launch receipt into new-node placement', async () => {
  const context = taskContext()
  context.nodesRef.current[0].data.task!.linkedAgentNodeId = null
  context.createNodeForSession = vi.fn(async () => null)
  vi.mocked(launchWorkspaceAgentSession).mockResolvedValue({
    sessionId: 'runtime',
    resumeSessionId: 'committed',
    profileId: null,
    effectiveModel: null,
    executionDirectory: '/repo',
    managedClaudeLifecycle: receipt,
  })
  await runTaskAgentAction('task', context)
  expect(context.createNodeForSession).toHaveBeenCalledWith(
    expect.objectContaining({ managedClaudeLifecycle: receipt }),
  )
})
