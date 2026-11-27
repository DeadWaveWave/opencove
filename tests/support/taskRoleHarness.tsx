import { useLayoutEffect } from 'react'
import type { Node } from '@xyflow/react'
import type { UpdateTaskStatus } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import { vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../src/contexts/settings/domain/agentSettings'
import { useWorkspaceCanvasNodeDeleteConfirmation } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDeleteConfirmation'
import { useWorkspaceCanvasRoleActions } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions'
import { useWorkspaceCanvasRoleUi } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasRoleUi'
import { useWorkspaceCanvasTaskActions } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions'
import { useWorkspaceCanvasTaskEditor } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskEditor'
import { useWorkspaceCanvasTaskNodeCreation } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskNodeCreation'
import {
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasUi,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  TaskAgentSessionRecord,
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../src/contexts/workspace/presentation/renderer/types'
import {
  agentNode,
  documentOf,
  renderInTwoWorkspaces,
  sized,
  taskNode,
  WORKSPACE_A,
} from './agentRuntimeHarness'
import { setDocumentNodes } from './documentNodes'

export interface TaskPatch {
  title?: string
  requirement?: string
  status?: NonNullable<TerminalNodeData['task']>['status']
  linkedAgentNodeId?: string | null
  agentSessions?: TaskAgentSessionRecord[]
}

/** A task node with the given task fields; linked to no agent unless it says so. */
export function taskNodeWith(id: string, patch: TaskPatch = {}): Node<TerminalNodeData> {
  const base = taskNode(id, '')
  const { title, ...task } = patch
  return {
    ...base,
    data: {
      ...base.data,
      title: title ?? base.data.title,
      task: {
        ...base.data.task!,
        status: 'todo',
        linkedAgentNodeId: null,
        ...task,
      },
    },
  }
}

export function sessionRecord(id: string, overrides: Partial<TaskAgentSessionRecord> = {}) {
  return {
    id,
    provider: 'codex',
    resumeSessionId: `${id}-resume`,
    resumeSessionIdVerified: true,
    prompt: 'resume me',
    model: 'gpt-5.2-codex',
    effectiveModel: 'gpt-5.2-codex',
    boundDirectory: '/tmp/bound',
    lastDirectory: '/tmp/bound',
    createdAt: '2026-03-15T00:00:00.000Z',
    lastRunAt: '2026-03-15T00:00:00.000Z',
    endedAt: null,
    exitCode: null,
    status: 'standby',
    ...overrides,
  } satisfies TaskAgentSessionRecord
}

/** A role node whose definition is `roleId` and whose last error is empty. */
export function roleNode(
  id: string,
  { roleId = 'role-1', input = 'do it' }: { roleId?: string; input?: string } = {},
): Node<TerminalNodeData> {
  return sized({
    id,
    type: 'roleNode',
    position: { x: 700, y: 0 },
    data: {
      sessionId: '',
      title: 'Role',
      width: 400,
      height: 300,
      kind: 'role',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
      role: {
        roleId,
        roleName: 'Role',
        roleDescription: '',
        promptTemplate: 'Do: {{input}}',
        inputHint: '',
        outputFormat: '',
        input,
        selectedProvider: 'codex',
        linkedAgentNodeId: null,
        runHistory: [],
        createdAt: null,
        updatedAt: null,
      },
    },
  })
}

export function spaceOf(
  id: string,
  nodeIds: string[],
  overrides: Partial<WorkspaceSpaceState> = {},
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: `/tmp/${id}`,
    targetMountId: null,
    labelColor: null,
    nodeIds,
    rect: { x: 0, y: 0, width: 2000, height: 1200 },
    ...overrides,
  }
}

/**
 * A ref whose every assignment is recorded. A hook that keeps its latest callback in a ref
 * assigns it again on each render, so `assigned[0]` is the one the first render made, and a case
 * can call it after a switch.
 */
export function recordingRef<T>(): { ref: { current: T }; assigned: T[] } {
  const assigned: T[] = []
  const ref = {
    get current(): T {
      return assigned[assigned.length - 1]
    },
    set current(next: T) {
      assigned.push(next)
    },
  }
  return { ref, assigned }
}

/** A promise that a case settles by hand, for an await a switch has to land in. */
export function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

export const BOUND = { mountId: null, executionDirectory: '/tmp/dir' }
export const LAUNCHED = {
  sessionId: 'launched-session',
  profileId: null,
  runtimeKind: 'pty',
  workerBinding: null,
  effectiveModel: null,
  resumeSessionId: null,
  executionDirectory: '/tmp/dir',
  managedClaudeLifecycle: undefined,
}
const EMPTY_TAGS: string[] = []
const METRICS = { fontSize: 13 }

type Documents = Parameters<typeof renderInTwoWorkspaces>[1]

/**
 * `stable` hands the hook writers that keep their identity across a switch, and write through the
 * node store of the latest render: only the reader then changes with the workspace, so a reader
 * missing from a dependency list shows. A case that follows a write across a switch passes `false`:
 * the writers of the render that made the callback write the workspace of that render.
 */
export interface RenderOptions {
  stable?: boolean
}

export function taskRefs() {
  return {
    run: recordingRef<(nodeId: string) => Promise<void>>(),
    resume: recordingRef<(taskNodeId: string, recordId: string) => Promise<void>>(),
    remove: recordingRef<(taskNodeId: string, recordId: string) => void>(),
    status: recordingRef<UpdateTaskStatus>(),
    title: recordingRef<(nodeId: string, title: string) => void>(),
    requirement: recordingRef<(nodeId: string, requirement: string) => void>(),
  }
}

/**
 * What the node store's creator does for a session: the agent node joins the nodes of workspace A,
 * where every case creates it, and the creator returns it.
 */
function createAgentNodeInA() {
  return vi.fn(async () => {
    const created = agentNode('created-agent')
    setDocumentNodes(WORKSPACE_A, [...documentOf(WORKSPACE_A).nodes, created])
    return created
  })
}

/**
 * The task actions, wired as the canvas wires them. Every callback the hook is called with keeps
 * its identity across a switch, so the reader's place in the dependency lists is observable.
 */
export function renderTaskActions(documents?: Documents, { stable = true }: RenderOptions = {}) {
  const refs = taskRefs()
  const launchAgentInNode = vi.fn(async () => undefined)
  const createNodeForSession = createAgentNodeInA()
  const buildAgentNodeTitle = (provider: string, label: string | null) => `${provider}:${label}`
  const rendered = renderInTwoWorkspaces(
    ({ nodeStore, stableSetNodes, stableUpdateCanvasDocument }) =>
      useWorkspaceCanvasTaskActions({
        updateCanvasDocument: stable ? stableUpdateCanvasDocument : nodeStore.updateCanvasDocument,
        setNodes: stable ? stableSetNodes : nodeStore.setNodes,
        createNodeForSession,
        buildAgentNodeTitle,
        launchAgentInNode,
        agentSettings: DEFAULT_AGENT_SETTINGS,
        workspaceId: 'workspace',
        workspacePath: '/repo',
        taskTagOptions: EMPTY_TAGS,
        terminalDisplayMetrics: METRICS,
        runTaskAgentRef: refs.run.ref,
        resumeTaskAgentSessionRef: refs.resume.ref,
        removeTaskAgentSessionRecordRef: refs.remove.ref,
        updateTaskStatusRef: refs.status.ref,
        quickUpdateTaskTitleRef: refs.title.ref,
        quickUpdateTaskRequirementRef: refs.requirement.ref,
      }),
    documents,
  )
  return { ...rendered, refs, launchAgentInNode, createNodeForSession }
}

export const ROLE = {
  id: 'role-1',
  name: 'Reviewer',
  description: '',
  promptTemplate: 'Review: {{input}}',
  inputHint: '',
  outputFormat: '',
  createdAt: '2026-03-15T00:00:00.000Z',
  updatedAt: '2026-03-15T00:00:00.000Z',
}
const ROLE_SETTINGS = {
  ...DEFAULT_AGENT_SETTINGS,
  projectRolesByWorkspaceId: { workspace: [ROLE] },
}

// One function for every render: a callback that lists it is rebuilt only for its own reasons.
const buildRoleAgentTitle = (provider: string, label: string | null) => `${provider}:${label}`

export function renderRoleActions(documents?: Documents, { stable = true }: RenderOptions = {}) {
  const run = recordingRef<(nodeId: string, input?: string) => Promise<void>>()
  const createNodeForSession = createAgentNodeInA()
  const appendRoleRunRecord = vi.fn()
  // As the node store's creator does: the role node joins the nodes of workspace A.
  const createRoleNode = vi.fn(() => {
    const created = roleNode('created-role')
    setDocumentNodes(WORKSPACE_A, [...documentOf(WORKSPACE_A).nodes, created])
    return created
  })
  const onShowMessage = vi.fn()
  const updateRoleProvider = vi.fn()
  const updateRoleInput = vi.fn()
  const actionRefs = {
    runRoleRef: run.ref,
    updateRoleProviderRef: { current: vi.fn() },
    updateRoleInputRef: { current: vi.fn() },
  } as never
  const rendered = renderInTwoWorkspaces(
    ({ nodeStore, stableSetNodes, stableUpdateCanvasDocument }) => {
      // The reader is made by the role UI and handed to the actions, as the canvas wires them.
      const readDocument = useReadCanvasDocument()
      return {
        ui: useCanvasUiCommands(),
        readUi: useReadCanvasUi(),
        roles: useWorkspaceCanvasRoleActions({
          workspaceId: 'workspace',
          workspacePath: '/repo',
          agentSettings: ROLE_SETTINGS,
          readDocument,
          setNodes: stable ? stableSetNodes : nodeStore.setNodes,
          updateCanvasDocument: stable
            ? stableUpdateCanvasDocument
            : nodeStore.updateCanvasDocument,
          onShowMessage,
          standardWindowSizeBucket: 'regular',
          createRoleNode,
          createNodeForSession,
          updateRoleProvider,
          updateRoleInput,
          appendRoleRunRecord,
          actionRefs,
          buildAgentNodeTitle: buildRoleAgentTitle,
        }),
      }
    },
    documents,
  )
  return {
    ...rendered,
    run,
    createNodeForSession,
    appendRoleRunRecord,
    createRoleNode,
    onShowMessage,
  }
}

export function renderEditor(documents?: Documents, { stable = true }: RenderOptions = {}) {
  const open = recordingRef<(nodeId: string) => void>()
  const rendered = renderInTwoWorkspaces(
    ({ nodeStore, stableSetNodes }) => ({
      readUi: useReadCanvasUi(),
      ui: useCanvasUiCommands(),
      editor: useWorkspaceCanvasTaskEditor({
        setNodes: stable ? stableSetNodes : nodeStore.setNodes,
        suggestTaskTitle: vi.fn(),
        taskTagOptions: EMPTY_TAGS,
        openTaskEditorRef: open.ref,
      }),
    }),
    documents,
  )
  return { ...rendered, open }
}

export function renderCreation(documents?: Documents, { stable = true }: RenderOptions = {}) {
  const createdTask = taskNodeWith('created-task')
  const createTaskNode = vi.fn(() => createdTask)
  // The node store's creator adds the task to the document before it returns it, and the Space
  // assignment takes the task from there (#758): the document of A holds it from the start.
  const seeded: Documents = {
    ...documents,
    a: { ...documents?.a, nodes: [...(documents?.a?.nodes ?? []), createdTask] },
  }
  const rendered = renderInTwoWorkspaces(
    ({ nodeStore, stableUpdateCanvasDocument }) =>
      useWorkspaceCanvasTaskNodeCreation({
        workspaceId: 'workspace',
        updateCanvasDocument: stable ? stableUpdateCanvasDocument : nodeStore.updateCanvasDocument,
        standardWindowSizeBucket: 'regular',
        createTaskNode,
      }),
    seeded,
  )
  return { ...rendered, createTaskNode }
}

export function renderConfirmation(documents?: Documents) {
  const requestNodeDelete = recordingRef<(nodeIds: readonly string[]) => void>()
  const closeNode = vi.fn(async () => undefined)
  const rendered = renderInTwoWorkspaces(() => {
    const confirmation = useWorkspaceCanvasNodeDeleteConfirmation({ closeNode })
    // What the canvas hands to its commands (S7, PR 4): the function of each render is recorded,
    // so a case can call the one a render of workspace A made after a switch.
    useLayoutEffect(() => {
      requestNodeDelete.ref.current = confirmation.requestNodeDelete
    }, [confirmation.requestNodeDelete])
    return { readUi: useReadCanvasUi(), confirmation }
  }, documents)
  return { ...rendered, requestNodeDelete, closeNode }
}

/**
 * The role UI as the canvas wires it: it makes the document reader and hands it to the role
 * actions. Everything else it is given keeps its identity across a switch.
 */
export function renderRoleUi(documents?: Documents) {
  const createRoleNode = vi.fn(() => roleNode('created-role'))
  const nodeStore = {
    createRoleNode,
    createNodeForSession: createAgentNodeInA(),
    updateRoleProvider: vi.fn(),
    updateRoleInput: vi.fn(),
    appendRoleRunRecord: vi.fn(),
  }
  const agentSupport = { buildAgentNodeTitle: () => 'Agent' }
  const actionRefs = {
    runRoleRef: { current: vi.fn() },
    updateRoleProviderRef: { current: vi.fn() },
    updateRoleInputRef: { current: vi.fn() },
  } as never
  const rendered = renderInTwoWorkspaces(
    ({ stableSetNodes, stableUpdateCanvasDocument }) => ({
      ui: useCanvasUiCommands(),
      roleUi: useWorkspaceCanvasRoleUi({
        workspaceId: 'workspace',
        workspacePath: '/repo',
        agentSettings: ROLE_SETTINGS,
        nodeStore: {
          ...nodeStore,
          setNodes: stableSetNodes,
          updateCanvasDocument: stableUpdateCanvasDocument,
        },
        agentSupport,
        actionRefs,
      }),
    }),
    documents,
  )
  return { ...rendered, createRoleNode }
}
