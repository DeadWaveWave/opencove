import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { rendererLifecycleFixture } from '../../support/managedClaudeRendererLifecycle'
import {
  mergeHydratedNode,
  toShellWorkspaceState,
} from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'

const api = window.opencoveApi
afterEach(() => {
  cleanup()
  window.opencoveApi = api
  vi.restoreAllMocks()
})

function workspace() {
  return toShellWorkspaceState(
    ensurePersistedWorkspace({
      id: 'workspace',
      name: 'Project',
      path: '/repo',
      spaces: [],
      nodes: [
        {
          id: 'agent',
          kind: 'agent',
          title: 'Agent',
          position: { x: 0, y: 0 },
          width: 600,
          height: 400,
          agent: { provider: 'codex', executionDirectory: '/repo', taskId: 'task' },
        },
        {
          id: 'task',
          kind: 'task',
          title: 'Task',
          position: { x: 600, y: 0 },
          width: 460,
          height: 280,
          task: {
            requirement: 'Work',
            linkedAgentNodeId: 'agent',
            status: 'doing',
            lastRunAt: 'old-run',
          },
        },
        {
          id: 'note',
          kind: 'note',
          title: 'Note',
          position: { x: 0, y: 400 },
          width: 300,
          height: 200,
          task: { text: 'Old body' },
        },
      ],
    })!,
  )
}

it.each([null, '', 'new-task'])('hydrates runtime without replacing current taskId=%s', taskId => {
  const [current] = workspace().nodes
  const older = structuredClone(current)
  current.data.agent!.taskId = taskId
  expect(mergeHydratedNode(current, older).data.agent?.taskId).toBe(taskId)
})

it('does not restore an old taskId when the current agent payload is absent', () => {
  const [current] = workspace().nodes
  const older = structuredClone(current)
  current.data.agent = null
  expect(mergeHydratedNode(current, older).data.agent?.taskId ?? null).toBeNull()
})

it.each([null, 'new-holder'])(
  'keeps current task fields over a delayed payload (holder=%s)',
  holder => {
    const current = workspace().nodes[1]
    const older = structuredClone(current)
    Object.assign(current.data.task!, {
      linkedAgentNodeId: holder,
      status: 'ai_done',
      lastRunAt: null,
    })
    expect(mergeHydratedNode(current, older).data.task).toBe(current.data.task)
  },
)

it.each(['', 'Old body\n\nWorker result'])('keeps the current note body %j', text => {
  const current = workspace().nodes[2]
  const older = structuredClone(current)
  current.data.note!.text = text
  expect(mergeHydratedNode(current, older).data.note).toBe(current.data.note)
})

it.each(
  [false, true].flatMap(owned =>
    [false, true].flatMap(mounted =>
      ['new', 'resume', 'switch'].flatMap(action =>
        [null, 'task'].map(taskId => ({ owned, mounted, action, taskId })),
      ),
    ),
  ),
)(
  'keeps relationships after delayed $action (owned=$owned, mount=$mounted, taskId=$taskId)',
  async ({ owned, mounted, action, taskId }) => {
    const f = rendererLifecycleFixture(mounted)
    if (!owned) {
      f.response.managedClaudeLifecycle = undefined
    }
    f.nodesRef.current[0].data.agent!.taskId = taskId === null ? 'task' : null
    f.nodesRef.current.push(workspace().nodes[1])
    let deliver!: () => void
    const pending = new Promise<void>(resolve => {
      deliver = resolve
    })
    f.launch.mockImplementation(async () => {
      await pending
      return f.response
    })
    let operation!: Promise<void>
    act(() => {
      operation =
        action === 'switch'
          ? f.result.current.switchAgentNodeSession('agent', {
              provider: 'claude-code',
              sessionId: 'effective',
              cwd: '/repo',
            } as never)
          : f.result.current.launchAgentInNode('agent', action === 'new' ? 'new' : 'resume')
    })
    await waitFor(() => expect(f.launch).toHaveBeenCalledOnce())
    // A canonical claim/release arrives while the runtime operation is in flight.
    f.setNodes(nodes =>
      nodes.map(node =>
        node.id === 'agent'
          ? { ...node, data: { ...node.data, agent: { ...node.data.agent!, taskId } } }
          : {
              ...node,
              data: {
                ...node.data,
                task: {
                  ...node.data.task!,
                  linkedAgentNodeId: taskId ? 'agent' : null,
                  status: taskId ? 'doing' : 'ai_done',
                  lastRunAt: 'current-run',
                },
              },
            },
      ),
    )
    await act(async () => {
      deliver()
      await operation
    })
    expect(f.nodesRef.current[0].data.sessionId).toBe('new')
    const persisted = toPersistedState([{ ...workspace(), nodes: f.nodesRef.current }], 'workspace')
    expect(persisted.workspaces[0].nodes[0].agent).toMatchObject({ taskId })
    expect(persisted.workspaces[0].nodes[1].task).toMatchObject({
      linkedAgentNodeId: taskId ? 'agent' : null,
      status: taskId ? 'doing' : 'ai_done',
      lastRunAt: 'current-run',
    })
  },
)
