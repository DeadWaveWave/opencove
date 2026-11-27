import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'

import {
  agentNode,
  documentOf,
  nodeOf,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
} from '../../support/agentRuntimeHarness'
import {
  BOUND,
  deferred,
  LAUNCHED,
  renderConfirmation,
  renderCreation,
  renderEditor,
  renderRoleActions,
  renderRoleUi,
  renderTaskActions,
  roleNode,
  sessionRecord,
  spaceOf,
  taskNodeWith,
} from '../../support/taskRoleHarness'
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'
import { setDocumentNodes } from '../../support/documentNodes'

// The task run, the task resume, the role run, the task editor, the task node creation, the role
// node creation and the delete confirmation read the committed document of the workspace whose
// render made them, from the store, when they run (#702, PR 11). Each case writes the store in the
// same call as the read, or shows another workspace: a read of a ref, a prop, React Flow or the
// canvas view gives another answer.
//
// The canvas store's own values keep the value of the first render, so only the document reader
// can make a callback follow the workspace shown. A reader missing from a dependency list, or
// frozen to the first render, then reads the first workspace after a switch. A switch moves the
// app store's active workspace too, as in the app.

const firstRender = vi.hoisted(() => ({ values: new Map<string, unknown>() }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext',
  async importOriginal => {
    const original = await importOriginal<Record<string, () => unknown>>()
    const stable = (name: string) => () => {
      const real = original[name]()
      if (!firstRender.values.has(name)) {
        firstRender.values.set(name, real)
      }
      return firstRender.values.get(name)
    }
    return {
      ...original,
      useCanvasUiCommands: stable('useCanvasUiCommands'),
      useCanvasSelectionCommands: stable('useCanvasSelectionCommands'),
      useCanvasDocumentCommands: stable('useCanvasDocumentCommands'),
      useReadCanvasUi: stable('useReadCanvasUi'),
      useReadCanvasSelection: stable('useReadCanvasSelection'),
    }
  },
)
// The writer is the provider's, and it changes with the workspace. Unless a case turns it off (the
// harness's `stable` option), the role hooks get one writer for the whole test, which writes through
// the writer of the latest render, so that a switch cannot rebuild a callback through it and hide a
// reader that is missing from a dependency list.
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeWriter',
  async importOriginal => {
    const { mockStableNodeWriter, writerPin } = await import('../../support/stableNodeWriter')
    return mockStableNodeWriter(
      await importOriginal<
        typeof import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeWriter')
      >(),
      () => writerPin.stable,
    )
  },
)
// `t` keeps its identity, as in the app: a new one on every render would rebuild a callback that
// lists it and hide a reader that is missing from the same list.
const translation = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => translation }))

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

// The run asks which provider owns the linked agent: the answer shows which workspace it read.
const managed = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeLifecycle',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    readManagedClaudeExecutionContext: (...args: unknown[]) => managed.read(...args),
  }),
)

beforeEach(() => {
  managed.read.mockReset().mockResolvedValue(null)
  firstRender.values.clear()
  launch.binding.mockReset().mockResolvedValue(BOUND)
  launch.session.mockReset().mockRejectedValue(new Error('stop after the binding'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the task run and the task resume', () => {
  const linkedTask = (id: string, agentId: string) =>
    taskNodeWith(id, { linkedAgentNodeId: agentId, requirement: 'Ship it' })

  describe('the run', () => {
    it('reuses an agent the store gained in the same call, in the shown workspace', async () => {
      const { refs, launchAgentInNode, showB } = renderTaskActions()

      await act(async () => {
        setDocumentNodes(A, [linkedTask('task-a', 'agent-a'), agentNode('agent-a')])
        await refs.run.ref.current('task-a')
      })
      expect(launchAgentInNode).toHaveBeenLastCalledWith(
        'agent-a',
        'new',
        expect.objectContaining({ prompt: 'Ship it' }),
      )

      showB()
      await act(async () => {
        setDocumentNodes(B, [linkedTask('task-b', 'agent-b'), agentNode('agent-b')])
        await refs.run.ref.current('task-b')
      })
      expect(launchAgentInNode).toHaveBeenLastCalledWith(
        'agent-b',
        'new',
        expect.objectContaining({ prompt: 'Ship it' }),
      )
      expect(launchAgentInNode).toHaveBeenCalledTimes(2)
    })

    it('runs the task of the workspace of the render that made the callback, not the one on display', async () => {
      const { refs, launchAgentInNode, showB } = renderTaskActions(
        {
          a: {
            nodes: [linkedTask('task-a', 'agent-a'), agentNode('agent-a')],
            spaces: [spaceOf('space-a', ['task-a'])],
          },
        },
        { stable: false },
      )
      const madeInA = refs.run.assigned[0]
      showB()

      await act(async () => {
        await madeInA('task-a')
      })

      expect(managed.read).toHaveBeenCalledWith('agent-a', 'codex')
      expect(launch.binding).toHaveBeenCalledWith(
        expect.objectContaining({ targetSpace: expect.objectContaining({ id: 'space-a' }) }),
      )
      expect(launchAgentInNode).toHaveBeenCalledWith('agent-a', 'new', expect.anything())
      expect(nodeOf(A, 'task-a').data.task?.status).toBe('doing')
      expect(documentOf(B).nodes).toEqual([])
    })

    it('finds and binds the agent in the workspace that started the run when the user switches during an await', async () => {
      const held = deferred<typeof BOUND>()
      launch.binding.mockReturnValueOnce(held.promise)
      const { refs, launchAgentInNode, showB, flushes } = renderTaskActions(
        {
          a: {
            nodes: [linkedTask('task-a', 'agent-a'), agentNode('agent-a')],
            spaces: [spaceOf('space-a', ['task-a'])],
          },
        },
        { stable: false },
      )
      let pending!: Promise<void>
      act(() => {
        pending = refs.run.ref.current('task-a')
      })
      showB()

      await act(async () => {
        held.resolve(BOUND)
        await pending
      })

      expect(launchAgentInNode).toHaveBeenCalledWith(
        'agent-a',
        'new',
        expect.objectContaining({ prompt: 'Ship it' }),
      )
      expect(nodeOf(A, 'agent-a').data.agent?.taskId).toBe('task-a')
      expect(nodeOf(A, 'task-a').data.task).toMatchObject({
        status: 'doing',
        linkedAgentNodeId: 'agent-a',
      })
      expect(documentOf(A).spaces[0].nodeIds).toContain('agent-a')
      expect(documentOf(B).nodes).toEqual([])
      expect(flushes).toHaveLength(1)
    })

    it('judges the linked agent after the binding await by the store, not by what was read before it', async () => {
      const held = deferred<typeof BOUND>()
      launch.binding.mockReturnValueOnce(held.promise)
      const { refs, launchAgentInNode } = renderTaskActions({
        a: {
          nodes: [
            taskNodeWith('task-a', { linkedAgentNodeId: 'agent-a', requirement: 'update' }),
            agentNode('agent-a'),
          ],
        },
      })
      let pending!: Promise<void>
      act(() => {
        pending = refs.run.ref.current('task-a')
      })

      // 'update' is a command of Claude Code, not a prompt: it is refused for that provider only.
      await act(async () => {
        setDocumentNodes(A, [
          taskNodeWith('task-a', { linkedAgentNodeId: 'agent-a', requirement: 'update' }),
          agentNode('agent-a', {}, { provider: 'claude-code' }),
        ])
        held.resolve(BOUND)
        await pending
      })

      expect(launchAgentInNode).not.toHaveBeenCalled()
      expect(nodeOf(A, 'task-a').data.task?.status).toBe('todo')
      expect(nodeOf(A, 'task-a').data.lastError).toEqual(expect.any(String))
    })

    it('does not reuse a linked agent that the store lost during the binding await', async () => {
      const held = deferred<typeof BOUND>()
      launch.binding.mockReturnValueOnce(held.promise)
      const { refs, launchAgentInNode } = renderTaskActions({
        a: { nodes: [linkedTask('task-a', 'agent-a'), agentNode('agent-a')] },
      })
      let pending!: Promise<void>
      act(() => {
        pending = refs.run.ref.current('task-a')
      })

      await act(async () => {
        setDocumentNodes(A, [linkedTask('task-a', 'agent-a')])
        held.resolve(BOUND)
        await pending
      })

      expect(launchAgentInNode).not.toHaveBeenCalled()
      expect(nodeOf(A, 'task-a').data.task?.linkedAgentNodeId).toBeNull()
      expect(launch.session).toHaveBeenCalledWith(expect.objectContaining({ mode: 'new' }))
    })

    it('judges the linked agent after the binding await in the workspace that started the run when the user switched during it', async () => {
      const held = deferred<typeof BOUND>()
      launch.binding.mockReturnValueOnce(held.promise)
      const { refs, launchAgentInNode, showB } = renderTaskActions(
        {
          a: {
            nodes: [
              taskNodeWith('task-a', { linkedAgentNodeId: 'agent-a', requirement: 'update' }),
              agentNode('agent-a'),
            ],
          },
        },
        { stable: false },
      )
      let pending!: Promise<void>
      act(() => {
        pending = refs.run.ref.current('task-a')
      })
      act(() => {
        setDocumentNodes(A, [
          taskNodeWith('task-a', { linkedAgentNodeId: 'agent-a', requirement: 'update' }),
          agentNode('agent-a', {}, { provider: 'claude-code' }),
        ])
      })
      showB()

      await act(async () => {
        held.resolve(BOUND)
        await pending
      })

      expect(launchAgentInNode).not.toHaveBeenCalled()
      // A refusal in A, not a launch after a failed lookup in B.
      expect(launch.session).not.toHaveBeenCalled()
      expect(nodeOf(A, 'task-a').data.lastError).toEqual(expect.any(String))
    })

    it('stops at a task the store does not hold', async () => {
      const { refs, launchAgentInNode, flushes } = renderTaskActions()

      await act(async () => {
        await refs.run.ref.current('task-a')
      })

      expect(launchAgentInNode).not.toHaveBeenCalled()
      expect(launch.binding).not.toHaveBeenCalled()
      expect(flushes).toHaveLength(0)
    })
  })

  describe('the resume', () => {
    const withRecord = (id: string) =>
      taskNodeWith(id, { agentSessions: [sessionRecord('record-1')] })

    it('resumes a session the store gained in the same call, in the shown workspace', async () => {
      const { refs, showB } = renderTaskActions()

      await act(async () => {
        setDocumentNodes(A, [withRecord('task-a')])
        await refs.resume.ref.current('task-a', 'record-1')
      })
      expect(launch.session).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode: 'resume', resumeSessionId: 'record-1-resume' }),
      )

      showB()
      await act(async () => {
        setDocumentNodes(B, [withRecord('task-b')])
        await refs.resume.ref.current('task-b', 'record-1')
      })
      expect(launch.session).toHaveBeenCalledTimes(2)
    })

    it('resumes the task of the workspace of the render that made the callback, not the one on display', async () => {
      const { refs, showB } = renderTaskActions(
        { a: { nodes: [withRecord('task-a')], spaces: [spaceOf('space-a', ['task-a'])] } },
        { stable: false },
      )
      const madeInA = refs.resume.assigned[0]
      showB()

      await act(async () => {
        await madeInA('task-a', 'record-1')
      })

      expect(launch.binding).toHaveBeenCalledWith(
        expect.objectContaining({ targetSpace: expect.objectContaining({ id: 'space-a' }) }),
      )
      expect(launch.session).toHaveBeenCalledWith(expect.objectContaining({ mode: 'resume' }))
    })

    it('binds the resumed agent in the workspace that started the resume when the user switches during an await', async () => {
      const held = deferred<typeof BOUND>()
      launch.binding.mockReturnValueOnce(held.promise)
      launch.session.mockResolvedValue(LAUNCHED)
      const { refs, createNodeForSession, showB, flushes } = renderTaskActions(
        { a: { nodes: [withRecord('task-a')], spaces: [spaceOf('space-a', ['task-a'])] } },
        { stable: false },
      )
      let pending!: Promise<void>
      act(() => {
        pending = refs.resume.ref.current('task-a', 'record-1')
      })
      showB()

      await act(async () => {
        held.resolve(BOUND)
        await pending
      })

      expect(createNodeForSession).toHaveBeenCalledTimes(1)
      expect(nodeOf(A, 'task-a').data.task).toMatchObject({
        status: 'doing',
        linkedAgentNodeId: 'created-agent',
      })
      expect(documentOf(A).spaces[0].nodeIds).toContain('created-agent')
      expect(documentOf(B).nodes).toEqual([])
      expect(flushes).toHaveLength(1)
    })
  })
})

describe('the role run', () => {
  it('runs a role node the store gained in the same call, in the shown workspace', async () => {
    const { run, showB } = renderRoleActions()

    await act(async () => {
      setDocumentNodes(A, [roleNode('role-a', { input: 'in A' })])
      await run.ref.current('role-a')
    })
    expect(launch.session).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('in A'), mode: 'new' }),
    )

    showB()
    await act(async () => {
      setDocumentNodes(B, [roleNode('role-b', { input: 'in B' })])
      await run.ref.current('role-b')
    })
    expect(launch.session).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('in B') }),
    )
    expect(launch.session).toHaveBeenCalledTimes(2)
  })

  it('runs the role node of the workspace of the render that made the callback, not the one on display', async () => {
    const { run, showB } = renderRoleActions(
      { a: { nodes: [roleNode('role-a')], spaces: [spaceOf('space-a', ['role-a'])] } },
      { stable: false },
    )
    const madeInA = run.assigned[0]
    showB()

    await act(async () => {
      await madeInA('role-a')
    })

    expect(launch.binding).toHaveBeenCalledWith(
      expect.objectContaining({ targetSpace: expect.objectContaining({ id: 'space-a' }) }),
    )
    expect(launch.session).toHaveBeenCalledTimes(1)
  })

  it('binds the agent in the workspace that started the run when the user switches during an await', async () => {
    const held = deferred<typeof BOUND>()
    launch.binding.mockReturnValueOnce(held.promise)
    launch.session.mockResolvedValue(LAUNCHED)
    const { run, createNodeForSession, appendRoleRunRecord, showB, flushes } = renderRoleActions(
      { a: { nodes: [roleNode('role-a')], spaces: [spaceOf('space-a', ['role-a'])] } },
      { stable: false },
    )
    let pending!: Promise<void>
    act(() => {
      pending = run.ref.current('role-a')
    })
    showB()

    await act(async () => {
      held.resolve(BOUND)
      await pending
    })

    expect(createNodeForSession).toHaveBeenCalledTimes(1)
    expect(documentOf(A).spaces[0].nodeIds).toContain('created-agent')
    expect(appendRoleRunRecord).toHaveBeenCalledWith(
      'role-a',
      expect.objectContaining({ linkedAgentNodeId: 'created-agent' }),
    )
    expect(nodeOf(A, 'role-a').data.title).toBe('Reviewer')
    expect(documentOf(B).nodes).toEqual([])
    expect(flushes).toHaveLength(1)
  })

  describe('the role node created in a Space', () => {
    const MENU = { kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 } as const

    it('is created in a Space the store gained in the same call, in the shown workspace', () => {
      const { view, createRoleNode, showB } = renderRoleActions()

      act(() => {
        replaceSpacesInStore(A, [spaceOf('space-a', [])])
        view.result.current.ui.openContextMenu(MENU)
        view.result.current.roles.runProjectRoleFromContextMenu('role-1')
      })
      expect(createRoleNode).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ targetSpaceRect: spaceOf('space-a', []).rect }),
      )
      expect(documentOf(A).spaces[0].nodeIds).toEqual(['created-role'])

      showB()
      act(() => {
        view.result.current.ui.openContextMenu(MENU)
        view.result.current.roles.runProjectRoleFromContextMenu('role-1')
      })
      expect(createRoleNode).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ targetSpaceRect: null }),
      )
    })

    it('is created in a Space of the workspace of the render that made the callback, not the one on display', () => {
      const { view, createRoleNode, showB } = renderRoleActions(
        { a: { spaces: [spaceOf('space-a', [])] } },
        { stable: false },
      )
      const madeInA = view.result.current
      showB()

      act(() => {
        madeInA.ui.openContextMenu(MENU)
        madeInA.roles.runProjectRoleFromContextMenu('role-1')
      })

      expect(createRoleNode).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ targetSpaceRect: spaceOf('space-a', []).rect }),
      )
      expect(documentOf(A).spaces[0].nodeIds).toEqual(['created-role'])
      expect(documentOf(B).spaces).toEqual([])
    })
  })
})

describe('the role UI', () => {
  const MENU = { kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 } as const

  // The UI makes the reader and hands it to the actions: a reader kept from the first render, or
  // one the actions do not rebuild their callbacks for, reads workspace A in workspace B.
  it('hands the role actions the reader of its own render', () => {
    const { view, createRoleNode, showB } = renderRoleUi({
      a: { spaces: [spaceOf('space-a', [])] },
      b: { spaces: [spaceOf('space-b', [], { rect: { x: 5000, y: 0, width: 100, height: 100 } })] },
    })

    act(() => {
      view.result.current.ui.openContextMenu(MENU)
      view.result.current.roleUi.runProjectRoleFromContextMenu('role-1')
    })
    expect(createRoleNode).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ targetSpaceRect: spaceOf('space-a', []).rect }),
    )

    showB()
    act(() => {
      view.result.current.ui.openContextMenu(MENU)
      view.result.current.roleUi.runProjectRoleFromContextMenu('role-1')
    })
    expect(createRoleNode).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ targetSpaceRect: null }),
    )
  })
})

describe('the task editor', () => {
  it('opens for a task the store gained in the same call, in the shown workspace', () => {
    const { view, open, showB } = renderEditor()

    act(() => {
      setDocumentNodes(A, [taskNodeWith('task-a', { title: 'Task A', requirement: 'in A' })])
      open.ref.current('task-a')
    })
    expect(view.result.current.readUi().taskEditor).toMatchObject({
      nodeId: 'task-a',
      title: 'Task A',
      requirement: 'in A',
    })

    showB()
    act(() => {
      setDocumentNodes(B, [taskNodeWith('task-b', { title: 'Task B', requirement: 'in B' })])
      open.ref.current('task-b')
    })
    expect(view.result.current.readUi().taskEditor).toMatchObject({
      nodeId: 'task-b',
      requirement: 'in B',
    })
  })

  it('opens for a task of the workspace of the render that made the callback, not the one on display', () => {
    const { view, open, showB } = renderEditor({
      a: { nodes: [taskNodeWith('task-a', { requirement: 'in A' })] },
    })
    const madeInA = open.assigned[0]
    showB()

    act(() => {
      madeInA('task-a')
    })

    expect(view.result.current.readUi().taskEditor).toMatchObject({ requirement: 'in A' })
  })

  it('ignores a node that is not a task', () => {
    const { view, open } = renderEditor({ a: { nodes: [roleNode('role-a')] } })

    act(() => {
      open.ref.current('role-a')
    })

    expect(view.result.current.readUi().taskEditor).toBeNull()
  })
})

describe('the task node creation', () => {
  const ANCHOR = { x: 400, y: 300 }

  it('places a task in a Space the store gained in the same call, in the shown workspace', () => {
    const { view, createTaskNode, showB } = renderCreation()

    act(() => {
      replaceSpacesInStore(A, [spaceOf('space-a', [])])
      view.result.current.createTaskAtPoint(ANCHOR)
    })
    expect(createTaskNode).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      '',
      false,
      'medium',
      [],
      { targetSpaceRect: spaceOf('space-a', []).rect },
    )
    expect(documentOf(A).spaces[0].nodeIds).toEqual(['created-task'])

    showB()
    act(() => {
      view.result.current.createTaskAtPoint(ANCHOR)
    })
    expect(createTaskNode).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      '',
      false,
      'medium',
      [],
      { targetSpaceRect: null },
    )
    expect(documentOf(B).spaces).toEqual([])
  })

  it('places a task in a Space of the workspace of the render that made the callback, not the one on display', () => {
    const { view, createTaskNode, showB } = renderCreation(
      { a: { spaces: [spaceOf('space-a', [])] } },
      { stable: false },
    )
    const madeInA = view.result.current
    showB()

    act(() => {
      madeInA.createTaskAtPoint(ANCHOR)
    })

    expect(createTaskNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '',
      false,
      'medium',
      [],
      { targetSpaceRect: spaceOf('space-a', []).rect },
    )
    expect(documentOf(A).spaces[0].nodeIds).toEqual(['created-task'])
    expect(documentOf(B).spaces).toEqual([])
  })
})

describe('the delete confirmation', () => {
  it('lists a node, and the Space it empties, that the store gained in the same call', () => {
    const { view, requestNodeDelete, showB } = renderConfirmation()

    act(() => {
      setDocumentNodes(A, [taskNodeWith('task-a', { title: 'Task A' })])
      replaceSpacesInStore(A, [spaceOf('space-a', ['task-a'])])
      requestNodeDelete.ref.current(['task-a'])
    })
    expect(view.result.current.readUi().nodeDeleteConfirmation).toEqual({
      nodeIds: ['task-a'],
      primaryNodeKind: 'task',
      primaryNodeTitle: 'Task A',
      emptyingSpaces: [{ id: 'space-a', name: 'space-a' }],
    })

    showB()
    act(() => {
      setDocumentNodes(B, [taskNodeWith('task-b', { title: 'Task B' })])
      requestNodeDelete.ref.current(['task-b'])
    })
    expect(view.result.current.readUi().nodeDeleteConfirmation).toMatchObject({
      nodeIds: ['task-b'],
      emptyingSpaces: [],
    })
  })

  it('lists the nodes of the workspace of the render that made the callback, not the one on display', () => {
    const { view, requestNodeDelete, showB } = renderConfirmation({
      a: { nodes: [taskNodeWith('task-a', { title: 'Task A' })] },
    })
    const madeInA = requestNodeDelete.assigned[0]
    showB()

    act(() => {
      madeInA(['task-a'])
    })

    expect(view.result.current.readUi().nodeDeleteConfirmation).toMatchObject({
      nodeIds: ['task-a'],
      primaryNodeTitle: 'Task A',
    })
  })

  it('does not list a node the store does not hold', () => {
    const { view, requestNodeDelete } = renderConfirmation({
      b: { nodes: [taskNodeWith('task-b')] },
    })

    act(() => {
      requestNodeDelete.ref.current(['task-b'])
    })

    expect(view.result.current.readUi().nodeDeleteConfirmation).toBeNull()
  })

  it('closes a node the store gained in the same call, and one of the workspace of the render', async () => {
    const { view, closeNode, showB } = renderConfirmation()
    const madeInA = view.result.current.confirmation

    await act(async () => {
      setDocumentNodes(A, [taskNodeWith('task-a')])
      await madeInA.requestNodeClose('task-a')
    })
    expect(closeNode).toHaveBeenLastCalledWith('task-a')

    showB()
    await act(async () => {
      await madeInA.requestNodeClose('task-a')
    })
    expect(closeNode).toHaveBeenCalledTimes(2)

    await act(async () => {
      await view.result.current.confirmation.requestNodeClose('task-a')
    })
    expect(closeNode).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().activeWorkspaceId).toBe(B)
  })
})
