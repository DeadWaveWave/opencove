import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agentNode,
  documentOf,
  nodeOf,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
  type TwoWorkspaces,
} from '../../support/agentRuntimeHarness'
import {
  BOUND,
  deferred,
  LAUNCHED,
  renderConfirmation,
  renderCreation,
  renderEditor,
  renderRoleActions,
  renderTaskActions,
  roleNode,
  sessionRecord,
  spaceOf,
  taskNodeWith,
} from '../../support/taskRoleHarness'

// The persistence flushes of the task actions, the task run and resume, the role actions and run,
// the task editor and the task node creation (#702, PR 11): each is requested once, after the write
// it follows, and as often as before. A flush is counted with the number of store writes that came
// before it and the document it saw, so one that is dropped, doubled or requested before its write
// fails. A branch that wrote nothing and did not flush before flushes nothing now.

vi.mock('@app/renderer/i18n', () => {
  const translation = { t: (key: string) => key }
  return { useTranslation: () => translation }
})

const launch = vi.hoisted(() => ({
  binding: vi.fn(),
  session: vi.fn(),
}))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared',
  () => ({
    buildMergedAgentLaunchEnv: vi.fn(() => ({})),
    resolveAgentExecutableOverride: vi.fn(() => undefined),
    resolveWorkspaceAgentLaunchBinding: (...args: unknown[]) => launch.binding(...args),
    launchWorkspaceAgentSession: (...args: unknown[]) => launch.session(...args),
  }),
)

beforeEach(() => {
  launch.binding.mockReset().mockResolvedValue(BOUND)
  launch.session.mockReset().mockRejectedValue(new Error('launch failed'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Forgets the store writes of the setup, so a count starts at the call under test. */
function settle({ harness }: Pick<TwoWorkspaces<unknown>, 'harness'>): void {
  harness.notifications.mockClear()
}

const taskOf = (workspaceId: string, taskId: string) => nodeOf(workspaceId, taskId).data.task!

describe('the task actions', () => {
  const task = () =>
    taskNodeWith('task-a', {
      status: 'doing',
      agentSessions: [sessionRecord('record-1'), sessionRecord('record-2')],
    })

  it.each([
    {
      name: 'removing a session record',
      call: (refs: ReturnType<typeof renderTaskActions>['refs']) =>
        refs.remove.ref.current('task-a', 'record-1'),
      seen: (document: ReturnType<typeof documentOf>) =>
        document.nodes[0].data.task?.agentSessions.map(record => record.id),
      expected: ['record-2'],
    },
    {
      name: 'changing the status',
      call: (refs: ReturnType<typeof renderTaskActions>['refs']) =>
        refs.status.ref.current('task-a', 'done'),
      seen: (document: ReturnType<typeof documentOf>) => document.nodes[0].data.task?.status,
      expected: 'done',
    },
    {
      name: 'renaming the task',
      call: (refs: ReturnType<typeof renderTaskActions>['refs']) =>
        refs.title.ref.current('task-a', '  Renamed  '),
      seen: (document: ReturnType<typeof documentOf>) => document.nodes[0].data.title,
      expected: 'Renamed',
    },
    {
      name: 'rewriting the requirement',
      call: (refs: ReturnType<typeof renderTaskActions>['refs']) =>
        refs.requirement.ref.current('task-a', 'Rewritten'),
      seen: (document: ReturnType<typeof documentOf>) => document.nodes[0].data.task?.requirement,
      expected: 'Rewritten',
    },
  ])('flushes once, on the write of $name', ({ call, seen, expected }) => {
    const rendered = renderTaskActions({ a: { nodes: [task()] } })
    settle(rendered)

    act(() => {
      call(rendered.refs)
    })

    expect(rendered.harness.notifications).toHaveBeenCalledTimes(1)
    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(seen(rendered.flushes[0].document)).toEqual(expected)
  })

  it('writes, and flushes, in the workspace of the render that made the callback', () => {
    const rendered = renderTaskActions(
      { a: { nodes: [task()] }, b: { nodes: [taskNodeWith('task-b', { status: 'doing' })] } },
      { stable: false },
    )
    const madeInA = rendered.refs.status.assigned[0]
    rendered.showB()
    settle(rendered)

    act(() => {
      madeInA('task-a', 'done')
    })
    expect(taskOf(A, 'task-a').status).toBe('done')
    expect(taskOf(B, 'task-b').status).toBe('doing')

    // The callback of the render that shows B writes B: it was rebuilt for the new writer.
    act(() => {
      rendered.refs.status.ref.current('task-b', 'done')
    })
    expect(taskOf(B, 'task-b').status).toBe('done')
    expect(rendered.flushes).toHaveLength(2)
  })

  it('does not flush for a requirement that is empty', () => {
    const rendered = renderTaskActions({ a: { nodes: [task()] } })
    settle(rendered)

    act(() => {
      rendered.refs.requirement.ref.current('task-a', '   ')
    })

    expect(rendered.harness.notifications).not.toHaveBeenCalled()
    expect(rendered.flushes).toHaveLength(0)
  })
})

describe('the task run flushes', () => {
  const linked = (agentId: string) =>
    taskNodeWith('task-a', { linkedAgentNodeId: agentId, requirement: 'Ship it' })

  async function run(rendered: ReturnType<typeof renderTaskActions>) {
    settle(rendered)
    await act(async () => {
      await rendered.refs.run.ref.current('task-a')
    })
  }

  it('flushes once, on the write that links the reused agent to its task', async () => {
    const rendered = renderTaskActions({ a: { nodes: [linked('agent-a'), agentNode('agent-a')] } })

    await run(rendered)

    expect(rendered.launchAgentInNode).toHaveBeenCalledTimes(1)
    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    const seen = rendered.flushes[0].document.nodes
    expect(seen.find(node => node.id === 'task-a')?.data.task).toMatchObject({
      status: 'doing',
      linkedAgentNodeId: 'agent-a',
    })
    expect(seen.find(node => node.id === 'agent-a')?.data.agent?.taskId).toBe('task-a')
  })

  it('flushes after the assignment of the reused agent to the Space of its task, and once', async () => {
    const rendered = renderTaskActions({
      a: {
        nodes: [linked('agent-a'), agentNode('agent-a')],
        spaces: [spaceOf('space-a', ['task-a'])],
      },
    })

    await run(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(2)
    expect(rendered.flushes[0].document.spaces[0].nodeIds).toContain('agent-a')
  })

  it('flushes on the write that clears a link to an agent that is gone, and again when the launch fails', async () => {
    const rendered = renderTaskActions({ a: { nodes: [linked('agent-gone')] } })

    await run(rendered)

    expect(rendered.flushes).toHaveLength(2)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.nodes[0].data.task?.linkedAgentNodeId).toBeNull()
    expect(rendered.flushes[0].document.nodes[0].data.lastError).toBeNull()
    expect(rendered.flushes[1].notificationsBefore).toBe(2)
    expect(rendered.flushes[1].document.nodes[0].data.lastError).toBe('messages.agentLaunchFailed')
  })

  it('flushes once, on the write that links the agent it created', async () => {
    launch.session.mockResolvedValue(LAUNCHED)
    const rendered = renderTaskActions({
      a: { nodes: [taskNodeWith('task-a', { requirement: 'Ship it' })] },
    })

    await run(rendered)

    // The creator's own write of the agent node comes first, then the write that links it.
    expect(rendered.createNodeForSession).toHaveBeenCalledTimes(1)
    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(2)
    expect(rendered.flushes[0].document.nodes[0].data.task).toMatchObject({
      status: 'doing',
      linkedAgentNodeId: 'created-agent',
    })
  })

  it('flushes once, on the write of the error, when the launch fails', async () => {
    const rendered = renderTaskActions({
      a: { nodes: [taskNodeWith('task-a', { requirement: 'Ship it' })] },
    })

    await run(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.nodes[0].data.lastError).toBe('messages.agentLaunchFailed')
  })

  it('flushes on the write that links the agent in the workspace that started the run after a switch', async () => {
    const held = deferred<typeof BOUND>()
    launch.binding.mockReturnValueOnce(held.promise)
    launch.session.mockResolvedValue(LAUNCHED)
    const rendered = renderTaskActions(
      { a: { nodes: [taskNodeWith('task-a', { requirement: 'Ship it' })] } },
      { stable: false },
    )
    settle(rendered)
    let pending!: Promise<void>
    act(() => {
      pending = rendered.refs.run.ref.current('task-a')
    })
    rendered.showB()

    await act(async () => {
      held.resolve(BOUND)
      await pending
    })

    // The recorder reads the workspace on display, which is B now: only the count is checked here.
    expect(rendered.flushes).toHaveLength(1)
    expect(taskOf(A, 'task-a').linkedAgentNodeId).toBe('created-agent')
  })

  it.each([
    {
      name: 'the requirement is empty',
      nodes: () => [taskNodeWith('task-a', { requirement: '   ' })],
      error: true,
    },
    {
      name: 'the prompt is refused for the provider',
      nodes: () => [taskNodeWith('task-a', { requirement: 'plugins\0 explain' })],
      error: true,
    },
    { name: 'the task is gone', nodes: () => [], error: false },
  ])('does not flush when $name', async ({ nodes, error }) => {
    const rendered = renderTaskActions({ a: { nodes: nodes() } })

    await run(rendered)

    expect(rendered.flushes).toHaveLength(0)
    expect(rendered.launchAgentInNode).not.toHaveBeenCalled()
    if (error) {
      expect(nodeOf(A, 'task-a').data.lastError).toEqual(expect.any(String))
    }
  })
})

describe('the task resume flushes', () => {
  const withRecord = (patch: Parameters<typeof taskNodeWith>[1] = {}, recordPatch = {}) =>
    taskNodeWith('task-a', { agentSessions: [sessionRecord('record-1', recordPatch)], ...patch })

  async function resume(rendered: ReturnType<typeof renderTaskActions>, recordId = 'record-1') {
    settle(rendered)
    await act(async () => {
      await rendered.refs.resume.ref.current('task-a', recordId)
    })
  }

  it('flushes once, on the write of the error, when the task already has a linked agent window', async () => {
    const rendered = renderTaskActions({
      a: { nodes: [withRecord({ linkedAgentNodeId: 'agent-a' })] },
    })

    await resume(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.nodes[0].data.lastError).toBe(
      'messages.taskLinkedAgentWindowOpen',
    )
    expect(launch.binding).not.toHaveBeenCalled()
  })

  it('flushes once, on the write of the error, when the record has no verified session', async () => {
    const rendered = renderTaskActions({
      a: { nodes: [withRecord({}, { resumeSessionIdVerified: false })] },
    })

    await resume(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.nodes[0].data.lastError).toBe(
      'messages.taskResumeSessionMissing',
    )
    expect(launch.binding).not.toHaveBeenCalled()
  })

  it('flushes once, on the write of the error, when the mounts cannot be listed', async () => {
    launch.binding.mockRejectedValue(new Error('no mounts'))
    const rendered = renderTaskActions({ a: { nodes: [withRecord()] } })

    await resume(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.nodes[0].data.lastError).toBe('messages.mountListFailed')
    expect(launch.session).not.toHaveBeenCalled()
  })

  it('flushes once, on the write that links the resumed agent', async () => {
    launch.session.mockResolvedValue(LAUNCHED)
    const rendered = renderTaskActions({ a: { nodes: [withRecord()] } })

    await resume(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(2)
    const seen = rendered.flushes[0].document.nodes[0].data
    expect(seen.task).toMatchObject({ status: 'doing', linkedAgentNodeId: 'created-agent' })
    expect(seen.lastError).toBeNull()
  })

  it('flushes once, on the write of the error, when the launch fails', async () => {
    const rendered = renderTaskActions({ a: { nodes: [withRecord()] } })

    await resume(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.nodes[0].data.lastError).toBe('messages.agentResumeFailed')
  })

  it.each([
    { name: 'the record is gone', nodes: () => [withRecord()], recordId: 'record-9' },
    { name: 'the task is gone', nodes: () => [], recordId: 'record-1' },
  ])('does not flush when $name', async ({ nodes, recordId }) => {
    const rendered = renderTaskActions({ a: { nodes: nodes() } })

    await resume(rendered, recordId)

    expect(rendered.flushes).toHaveLength(0)
    expect(launch.binding).not.toHaveBeenCalled()
  })
})

describe('the role run flushes', () => {
  const nodes = () => [roleNode('role-a', { input: 'in A' })]

  async function run(rendered: ReturnType<typeof renderRoleActions>, input?: string) {
    settle(rendered)
    await act(async () => {
      await rendered.run.ref.current('role-a', input)
    })
  }

  it('flushes once, on the write of the error, when the role has no definition', async () => {
    const rendered = renderRoleActions({
      a: { nodes: [roleNode('role-a', { roleId: 'role-missing' })] },
    })

    await run(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.nodes[0].data.lastError).toBe(
      'roleNode.missingRoleDefinition',
    )
    expect(launch.binding).not.toHaveBeenCalled()
  })

  it('flushes once, on the write that records the run, after the agent joined the Space', async () => {
    launch.session.mockResolvedValue(LAUNCHED)
    const rendered = renderRoleActions({
      a: { nodes: nodes(), spaces: [spaceOf('space-a', ['role-a'])] },
    })

    await run(rendered)

    expect(rendered.appendRoleRunRecord).toHaveBeenCalledTimes(1)
    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(3)
    expect(rendered.flushes[0].document.spaces[0].nodeIds).toContain('created-agent')
    expect(rendered.flushes[0].document.nodes[0].data).toMatchObject({
      title: 'Reviewer',
      lastError: null,
    })
  })

  it('flushes once, on the write that records the run, for a role outside every Space', async () => {
    launch.session.mockResolvedValue(LAUNCHED)
    const rendered = renderRoleActions({ a: { nodes: nodes() } })

    await run(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(2)
    expect(rendered.flushes[0].document.nodes[0].data.title).toBe('Reviewer')
  })

  it('flushes once, on the write of the error, before it shows the message, when the launch fails', async () => {
    const rendered = renderRoleActions({ a: { nodes: nodes() } })
    rendered.onShowMessage.mockImplementation(() => {
      expect(rendered.flushes).toHaveLength(1)
    })

    await run(rendered)

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.nodes[0].data.lastError).toBe('messages.agentLaunchFailed')
    expect(rendered.onShowMessage).toHaveBeenCalledWith('messages.agentLaunchFailed', 'error')
  })

  it('does not flush when the prompt is refused for the provider', async () => {
    const rendered = renderRoleActions({ a: { nodes: nodes() } })

    await run(rendered, 'plugins\0 explain')

    expect(rendered.flushes).toHaveLength(0)
    expect(nodeOf(A, 'role-a').data.lastError).toEqual(expect.any(String))
    expect(launch.binding).not.toHaveBeenCalled()
  })

  it('does not flush for a role node that is gone', async () => {
    const rendered = renderRoleActions()

    await run(rendered)

    expect(rendered.flushes).toHaveLength(0)
  })
})

describe('the role node creation and the role dialog flush', () => {
  const MENU = { kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 } as const

  it('flushes once, after the new role node joined the Space it was created in', () => {
    const rendered = renderRoleActions({ a: { spaces: [spaceOf('space-a', [])] } })
    settle(rendered)

    act(() => {
      rendered.view.result.current.ui.openContextMenu(MENU)
      rendered.view.result.current.roles.runProjectRoleFromContextMenu('role-1')
    })

    // The creator's own write of the role node comes first, then the assignment to the Space.
    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(2)
    expect(rendered.flushes[0].document.spaces[0].nodeIds).toEqual(['created-role'])
    expect(rendered.flushes[0].document.nodes.map(node => node.id)).toContain('created-role')
  })

  it('does not flush for a role node created outside every Space', () => {
    const rendered = renderRoleActions()
    settle(rendered)

    act(() => {
      rendered.view.result.current.ui.openContextMenu(MENU)
      rendered.view.result.current.roles.runProjectRoleFromContextMenu('role-1')
    })

    expect(rendered.createRoleNode).toHaveBeenCalledTimes(1)
    expect(rendered.flushes).toHaveLength(0)
  })

  it('flushes once for a role deleted from the project, with the settings write before it', () => {
    const rendered = renderRoleActions()
    settle(rendered)

    act(() => {
      rendered.view.result.current.roles.deleteProjectRole('role-1')
    })

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
  })

  it('flushes once, on the write that renames the role nodes, when a role is edited', () => {
    const rendered = renderRoleActions({ a: { nodes: [roleNode('role-a')] } })
    act(() => {
      rendered.view.result.current.roles.openRoleEditor('role-1')
    })
    act(() => {
      rendered.view.result.current.ui.updateDialog('roleCreator', current => ({
        ...current,
        name: 'Renamed role',
      }))
    })
    settle(rendered)

    act(() => {
      rendered.view.result.current.roles.createRole()
    })

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].document.nodes[0].data.title).toBe('Renamed role')
    expect(rendered.view.result.current.readUi().roleCreator).toBeNull()
  })

  it.each([
    { name: 'inside a Space', spaces: [spaceOf('space-a', [])], flushes: 2 },
    { name: 'outside every Space', spaces: [], flushes: 1 },
  ])('flushes $flushes time(s) for a role created $name', ({ spaces, flushes }) => {
    const rendered = renderRoleActions({ a: { spaces } })
    act(() => {
      rendered.view.result.current.ui.openContextMenu(MENU)
    })
    act(() => {
      rendered.view.result.current.roles.openRoleCreator()
    })
    act(() => {
      rendered.view.result.current.ui.updateDialog('roleCreator', current => ({
        ...current,
        name: 'Brand new',
        promptTemplate: 'Do it',
      }))
    })
    settle(rendered)

    act(() => {
      rendered.view.result.current.roles.createRole()
    })

    expect(rendered.createRoleNode).toHaveBeenCalledTimes(1)
    expect(rendered.flushes).toHaveLength(flushes)
    // Every flush follows the creation: the document it sees already holds the new role node.
    for (const flush of rendered.flushes) {
      expect(flush.document.nodes.map(node => node.id)).toContain('created-role')
    }
    expect(rendered.view.result.current.readUi().roleCreator).toBeNull()
  })

  it('does not flush for a role dialog that is refused', () => {
    const rendered = renderRoleActions()
    act(() => {
      rendered.view.result.current.ui.openContextMenu(MENU)
    })
    act(() => {
      rendered.view.result.current.roles.openRoleCreator()
    })
    settle(rendered)

    act(() => {
      rendered.view.result.current.roles.createRole()
    })

    expect(rendered.flushes).toHaveLength(0)
    expect(rendered.createRoleNode).not.toHaveBeenCalled()
  })
})

describe('the task editor flush', () => {
  async function save(rendered: ReturnType<typeof renderEditor>, title: string) {
    act(() => {
      rendered.open.ref.current('task-a')
    })
    act(() => {
      rendered.view.result.current.ui.updateDialog('taskEditor', current => ({ ...current, title }))
    })
    settle(rendered)
    await act(async () => {
      await rendered.view.result.current.editor.saveTaskEdits()
    })
  }

  it('flushes once, on the write of the saved task, and closes the editor', async () => {
    const rendered = renderEditor({
      a: { nodes: [taskNodeWith('task-a', { title: 'Before', requirement: 'Do it' })] },
    })

    await save(rendered, 'After')

    expect(rendered.harness.notifications).toHaveBeenCalledTimes(1)
    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.nodes[0].data.title).toBe('After')
    expect(rendered.view.result.current.readUi().taskEditor).toBeNull()
  })

  it('does not flush when the title is empty and cannot be generated', async () => {
    const rendered = renderEditor({
      a: { nodes: [taskNodeWith('task-a', { title: 'Before', requirement: 'Do it' })] },
    })

    await save(rendered, '')

    expect(rendered.flushes).toHaveLength(0)
    expect(nodeOf(A, 'task-a').data.title).toBe('Before')
  })
})

describe('the task node creation flush', () => {
  const ANCHOR = { x: 400, y: 300 }

  it('flushes once, after the new task joined the Space it was created in', () => {
    const rendered = renderCreation({ a: { spaces: [spaceOf('space-a', [])] } })
    settle(rendered)

    act(() => {
      rendered.view.result.current.createTaskAtPoint(ANCHOR)
    })

    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(1)
    expect(rendered.flushes[0].document.spaces[0].nodeIds).toEqual(['created-task'])
  })

  it('flushes once for a task created outside every Space, with no write of its own', () => {
    const rendered = renderCreation()
    settle(rendered)

    act(() => {
      rendered.view.result.current.createTaskAtPoint(ANCHOR)
    })

    expect(rendered.createTaskNode).toHaveBeenCalledTimes(1)
    expect(rendered.harness.notifications).not.toHaveBeenCalled()
    expect(rendered.flushes).toHaveLength(1)
    expect(rendered.flushes[0].notificationsBefore).toBe(0)
  })

  it('does not flush when no task was created', () => {
    const rendered = renderCreation()
    rendered.createTaskNode.mockReturnValueOnce(null as never)
    settle(rendered)

    act(() => {
      rendered.view.result.current.createTaskAtPoint(ANCHOR)
    })

    expect(rendered.flushes).toHaveLength(0)
  })
})

describe('the delete confirmation', () => {
  it('flushes nothing, and writes nothing, when it opens', () => {
    const rendered = renderConfirmation({ a: { nodes: [taskNodeWith('task-a')] } })
    settle(rendered)

    act(() => {
      rendered.requestNodeDelete.ref.current(['task-a'])
    })

    expect(rendered.harness.notifications).not.toHaveBeenCalled()
    expect(rendered.flushes).toHaveLength(0)
  })
})
