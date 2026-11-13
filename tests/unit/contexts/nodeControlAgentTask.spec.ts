// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import { makeNode } from '../../../src/contexts/workspace/application/nodeControl/nodeDataFactory'
import type {
  NodeControlAppState,
  NodeControlAppStateStore,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'
import { createMinimalState } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

const now = new Date('2026-11-12T00:00:00.000Z')
function fixture() {
  let state = createMinimalState('/repo', 'project', 'space') as NodeControlAppState
  let revision = 1
  const task = makeNode({
    id: 'task',
    kind: 'task',
    title: 'Task',
    now: '2026-01-01T00:00:00.000Z',
    frame: { x: 0, y: 0, width: 320, height: 240 },
    data: {
      kind: 'task',
      requirement: 'Implement it',
      status: 'todo',
      priority: 'medium',
      tags: [],
    },
  })
  state.workspaces[0].nodes = [task]
  state.workspaces[0].spaces[0].nodeIds = ['task']
  const write = vi.fn<NodeControlAppStateStore['writeAppState']>(async (next, options) => {
    if (options?.expectedRevision !== revision) {
      return {
        ok: false,
        reason: 'unknown',
        error: createAppErrorDescriptor('persistence.invalid_state', {
          debugMessage: `App state revision conflict (expected=${options?.expectedRevision}, current=${revision}).`,
        }),
      }
    }
    state = structuredClone(next)
    return { ok: true, level: 'full', bytes: 1, revision: ++revision }
  })
  const store: NodeControlAppStateStore = {
    readAppState: async () => structuredClone(state),
    readAppStateRevision: async () => revision,
    writeAppState: write,
    nodeLineage: { readMany: async () => new Map() },
    commitCreatedNodeState: vi.fn((next, options) => write(next, options)),
  }
  const runtime = {
    launchAgent: vi.fn(async () => ({
      sessionId: 'session',
      provider: 'codex' as const,
      prompt: 'Inspect',
      model: null,
      effectiveModel: null,
      executionDirectory: '/repo',
      expectedDirectory: '/repo',
      startedAt: now.toISOString(),
      profileId: null,
      runtimeKind: null,
      workerBinding: { endpointId: 'local', mountId: null },
    })),
    spawnTerminal: vi.fn(),
    killSession: vi.fn(),
  }
  const run = (
    data: Record<string, unknown> = { taskNodeId: 'task' },
    root = false,
    callerNodeId?: string,
  ) =>
    createNodeForNodeControl({
      store,
      runtime,
      now,
      callerNodeId,
      locatorDeps: {
        listEndpoints: async () => [
          {
            endpointId: 'local',
            kind: 'local',
            displayName: 'Local',
            createdAt: '',
            updatedAt: '',
            remote: null,
          },
        ],
        listMounts: async () => [
          {
            mountId: 'local-mount',
            projectId: 'project',
            endpointId: 'local',
            targetId: 'local',
            name: 'Local',
            sortOrder: 0,
            rootPath: '/repo',
            rootUri: 'file:///repo',
            createdAt: '',
            updatedAt: '',
          },
        ],
        listWorktreesForMount: async () => [],
        listWorktreesForWorkspace: async () => [],
      },
      input: {
        kind: 'agent',
        ...(root ? { projectId: 'project' } : { space: { kind: 'spaceId', spaceId: 'space' } }),
        data,
      },
    })
  return {
    store,
    runtime,
    write,
    run,
    state: () => state,
    advance: (change: (state: NodeControlAppState) => void) => {
      change(state)
      revision++
    },
  }
}

describe('agent creation task link', () => {
  it.each([undefined, 'task'])(
    'commits both links and doing in one write (caller=%s)',
    async caller => {
      const f = fixture()
      const before = structuredClone(f.state())
      const launch = f.runtime.launchAgent.getMockImplementation()!
      f.runtime.launchAgent.mockImplementationOnce(async () => {
        expect(f.state()).toEqual(before)
        expect(f.write).not.toHaveBeenCalled()
        return launch()
      })
      const result = await f.run({ taskNodeId: 'task', agentFullAccess: false }, false, caller)
      expect(f.write).toHaveBeenCalledTimes(1)
      expect(f.store.commitCreatedNodeState).toHaveBeenCalledTimes(caller ? 1 : 0)
      const nodes = f.write.mock.calls[0][0].workspaces[0].nodes
      expect(nodes.find(n => n.id === result.node.id)?.agent).toMatchObject({
        taskId: 'task',
        agentFullAccess: false,
      })
      expect(nodes[0].task).toMatchObject({
        linkedAgentNodeId: result.node.id,
        status: 'doing',
        updatedAt: now.toISOString(),
        lastRunAt: now.toISOString(),
        agentSessions: [],
      })
      expect(before.workspaces[0].nodes[0].task).toMatchObject({
        status: 'todo',
        linkedAgentNodeId: null,
      })
    },
  )

  it('leaves the task untouched and agent.taskId null when omitted', async () => {
    const f = fixture(),
      before = structuredClone(f.state().workspaces[0].nodes[0])
    const result = await f.run({})
    expect(f.state().workspaces[0].nodes[0]).toEqual(before)
    expect(f.state().workspaces[0].nodes.find(n => n.id === result.node.id)?.agent).toMatchObject({
      taskId: null,
    })
  })

  it.each(['missing', 'other-project', 'non-task', 'cross-space', 'live-linked', 'root-to-space'])(
    'rejects %s before launch',
    async scenario => {
      const f = fixture()
      f.advance(state => {
        const workspace = state.workspaces[0],
          task = workspace.nodes[0]
        if (scenario === 'missing') {
          workspace.nodes = []
        }
        if (scenario === 'other-project') {
          state.workspaces.push({ ...structuredClone(workspace), id: 'other-project', spaces: [] })
          workspace.nodes = []
        }
        if (scenario === 'non-task') {
          task.kind = 'note'
        }
        if (scenario === 'cross-space') {
          workspace.spaces[0].nodeIds = []
        }
        if (scenario === 'live-linked') {
          task.task = { ...(task.task as object), linkedAgentNodeId: 'existing' }
          workspace.nodes.push({ ...task, id: 'existing', kind: 'agent' })
        }
      })
      const before = structuredClone(f.state())
      await expect(f.run(undefined, scenario === 'root-to-space')).rejects.toMatchObject({
        code: ['missing', 'other-project'].includes(scenario)
          ? 'node.not_found'
          : 'common.invalid_input',
      })
      expect(f.runtime.launchAgent).not.toHaveBeenCalled()
      expect(f.write).not.toHaveBeenCalled()
      expect(f.state()).toEqual(before)
    },
  )

  it('replaces a stale link and preserves existing history', async () => {
    const f = fixture()
    f.advance(state => {
      state.workspaces[0].nodes[0].task = {
        ...(state.workspaces[0].nodes[0].task as object),
        linkedAgentNodeId: 'missing-agent',
        agentSessions: [{ id: 'previous-session' }],
      }
    })
    const result = await f.run()
    expect(f.state().workspaces[0].nodes[0].task).toMatchObject({
      linkedAgentNodeId: result.node.id,
      status: 'doing',
      agentSessions: [{ id: 'previous-session' }],
    })
  })

  it('allows both nodes on the root canvas', async () => {
    const f = fixture()
    f.advance(state => {
      state.workspaces[0].spaces[0].nodeIds = []
    })
    expect((await f.run(undefined, true)).spaceId).toBeNull()
    expect(f.state().workspaces[0].nodes[0].task).toMatchObject({ status: 'doing' })
  })

  it.each([null, '', ' \t ', 1, false, {}, []].map(taskNodeId => ({ taskNodeId })))(
    'rejects invalid taskNodeId=$taskNodeId before launch',
    async ({ taskNodeId }) => {
      const f = fixture()
      await expect(f.run({ taskNodeId })).rejects.toMatchObject({ code: 'common.invalid_input' })
      expect(f.runtime.launchAgent).not.toHaveBeenCalled()
      expect(f.write).not.toHaveBeenCalled()
    },
  )

  it('leaves the task unchanged when launch fails', async () => {
    const f = fixture(),
      before = structuredClone(f.state())
    f.runtime.launchAgent.mockRejectedValueOnce(new Error('launch failed'))
    await expect(f.run()).rejects.toThrow('launch failed')
    expect(f.write).not.toHaveBeenCalled()
    expect(f.state()).toEqual(before)
  })

  it('leaves nothing persisted and kills the session after a definite write failure', async () => {
    const f = fixture(),
      before = structuredClone(f.state())
    f.write.mockResolvedValueOnce({
      ok: false,
      reason: 'io',
      error: createAppErrorDescriptor('persistence.io_failed'),
    })
    await expect(f.run()).rejects.toMatchObject({ code: 'persistence.io_failed' })
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.runtime.killSession).toHaveBeenCalledExactlyOnceWith('session')
    expect(f.state()).toEqual(before)
  })

  it.each(['launch', 'CAS'])(
    'revalidates a competing link after %s without launching twice',
    async phase => {
      const f = fixture()
      const linkElsewhere = () =>
        f.advance(state => {
          const task = state.workspaces[0].nodes[0]
          task.task = { ...(task.task as object), linkedAgentNodeId: 'winner', status: 'doing' }
          state.workspaces[0].nodes.push({
            ...task,
            id: 'winner',
            kind: 'agent',
            agent: { taskId: 'task' },
          })
        })
      if (phase === 'launch') {
        const launch = f.runtime.launchAgent.getMockImplementation()!
        f.runtime.launchAgent.mockImplementationOnce(async () => {
          linkElsewhere()
          return launch()
        })
      } else {
        const write = f.write.getMockImplementation()!
        f.write.mockImplementationOnce(async (next, options) => {
          linkElsewhere()
          return write(next, options)
        })
      }
      await expect(f.run()).rejects.toMatchObject({ code: 'common.invalid_input' })
      expect(f.runtime.launchAgent).toHaveBeenCalledTimes(1)
      expect(f.write).toHaveBeenCalledTimes(phase === 'launch' ? 0 : 1)
      expect(f.runtime.killSession).toHaveBeenCalledExactlyOnceWith('session')
      expect(f.state().workspaces[0].nodes.map(n => n.id)).toEqual(['task', 'winner'])
      expect(f.state().workspaces[0].nodes[0].task).toMatchObject({ linkedAgentNodeId: 'winner' })
    },
  )
})
