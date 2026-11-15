import React from 'react'
import { act, render, renderHook } from '@testing-library/react'
import { ReactFlowProvider, type Node, type ReactFlowInstance } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MountDto } from '@shared/contracts/dto'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasSpaces } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaces'
import { useWorkspaceCanvasTaskEditor } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskEditor'
import type { CanvasSelectionCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.selection'
import type { CanvasUiCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.ui'
import { createCanvasDocumentHarness } from '../../support/canvasDocumentHarness'
import {
  CanvasStoreProvider,
  useCanvasSelectionCommands,
  useCanvasUiCommands,
  useReadCanvasUi,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// The task editor only awaits something when AI naming is on, so the async cases need it enabled.
vi.mock('@shared/featureFlags/aiNaming', () => ({
  AI_NAMING_FEATURES: { taskTitleGeneration: true, worktreeNameSuggestion: false },
}))

afterEach(() => vi.unstubAllGlobals())

interface StoreHandle {
  readUi: ReturnType<typeof useReadCanvasUi>
  commands: CanvasUiCommands
  selection: CanvasSelectionCommands
}

/** Records the store of the latest render, and every store the provider has created so far. */
function createStoreRecorder() {
  const stores: StoreHandle[] = []
  function Probe(): null {
    const readUi = useReadCanvasUi()
    const commands = useCanvasUiCommands()
    const selection = useCanvasSelectionCommands()
    if (stores.at(-1)?.commands !== commands) {
      stores.push({ readUi, commands, selection })
    }
    return null
  }
  return { stores, Probe, current: () => stores.at(-1) as StoreHandle }
}

function createWrapper(initialWorkspaceId: string) {
  const recorder = createStoreRecorder()
  let workspaceId = initialWorkspaceId
  function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return (
      <ReactFlowProvider>
        <CanvasStoreProvider workspaceId={workspaceId}>
          <recorder.Probe />
          {children}
        </CanvasStoreProvider>
      </ReactFlowProvider>
    )
  }
  return {
    recorder,
    Wrapper,
    switchWorkspace: (nextWorkspaceId: string) => {
      workspaceId = nextWorkspaceId
    },
  }
}

const NODE: Node<TerminalNodeData> = {
  id: 'node-1',
  type: 'terminal',
  position: { x: 0, y: 0 },
  width: 400,
  height: 300,
  data: {
    sessionId: 'session-1',
    title: 'Terminal',
    width: 400,
    height: 300,
    kind: 'terminal',
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
  },
}

const SPACE: WorkspaceSpaceState = {
  id: 'space-1',
  name: 'Space 1',
  directoryPath: '/tmp/space-1',
  targetMountId: null,
  labelColor: null,
  nodeIds: [],
  rect: { x: 0, y: 0, width: 600, height: 400 },
}

function mount(mountId: string): MountDto {
  return {
    mountId,
    projectId: 'workspace-a',
    endpointId: 'local',
    targetId: `target-${mountId}`,
    rootPath: `/repo/${mountId}`,
    rootUri: `file:///repo/${mountId}`,
    name: mountId,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  }
}

function renderSpaces(
  options: {
    wrapper: ReturnType<typeof createWrapper>
    spaces?: WorkspaceSpaceState[]
    selectedNodeIds?: string[]
  },
  workspaceId = 'workspace-a',
) {
  const reactFlow = {
    getNodes: () => [NODE],
    flowToScreenPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
  const spaces = options.spaces ?? [SPACE]
  // The hook reads and writes the committed document of workspace A.
  const harness = createCanvasDocumentHarness({ workspaceId: 'workspace-a', nodes: [NODE], spaces })
  const rendered = renderHook(
    (props: { workspaceId: string }) =>
      useWorkspaceCanvasSpaces({
        workspaceId: props.workspaceId,
        activeSpaceId: null,
        onActiveSpaceChange: vi.fn(),
        workspacePath: '/tmp/workspace',
        focusNodeTargetZoom: 1,
        standardWindowSizeBucket: 'regular',
        reactFlow,
        nodes: [NODE],
        updateCanvasDocument: vi.fn(),
        spaces,
      }),
    { initialProps: { workspaceId }, wrapper: options.wrapper.Wrapper },
  )
  if (options.selectedNodeIds) {
    const nodeIds = options.selectedNodeIds
    act(() => options.wrapper.recorder.current().selection.setNodeIds(nodeIds))
  }
  return { ...rendered, harness }
}

describe('Space rename through the canvas store', () => {
  it('writes the Spaces with the draft that is in the store when the rename commits', () => {
    const wrapper = createWrapper('workspace-a')
    const { result, harness } = renderSpaces({ wrapper })

    act(() => result.current.activateSpaceTitle('space-1', 'near'))
    expect(wrapper.recorder.current().readUi().spaceRename).toEqual({
      spaceId: 'space-1',
      draft: 'Space 1',
    })

    act(() => wrapper.recorder.current().commands.setSpaceRenameDraft('  Renamed  '))
    act(() => result.current.commitSpaceRename('space-1'))

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().spaces).toEqual([{ ...SPACE, name: 'Renamed' }])
    expect(wrapper.recorder.current().readUi().spaceRename).toBeNull()
  })

  it('does nothing when the rename commits after it was cancelled, even from a stale handler', () => {
    const wrapper = createWrapper('workspace-a')
    const { result, harness } = renderSpaces({ wrapper })

    act(() => result.current.activateSpaceTitle('space-1', 'near'))
    const staleCommit = result.current.commitSpaceRename

    act(() => wrapper.recorder.current().commands.cancelSpaceRename())
    act(() => staleCommit('space-1'))
    act(() => result.current.commitSpaceRename('space-1'))

    expect(harness.notifications).not.toHaveBeenCalled()
  })

  it('does nothing when the commit names another Space than the one being renamed', () => {
    const wrapper = createWrapper('workspace-a')
    const other = { ...SPACE, id: 'space-2', name: 'Space 2' }
    const { result, harness } = renderSpaces({ wrapper, spaces: [SPACE, other] })

    act(() => result.current.activateSpaceTitle('space-1', 'near'))
    act(() => result.current.commitSpaceRename('space-2'))

    expect(harness.notifications).not.toHaveBeenCalled()
  })

  it('cancels the rename when its Space disappears', () => {
    const wrapper = createWrapper('workspace-a')
    const { result, rerender } = renderHook(
      (props: { spaces: WorkspaceSpaceState[] }) =>
        useWorkspaceCanvasSpaces({
          workspaceId: 'workspace-a',
          activeSpaceId: null,
          onActiveSpaceChange: vi.fn(),
          workspacePath: '/tmp/workspace',
          focusNodeTargetZoom: 1,
          standardWindowSizeBucket: 'regular',
          reactFlow: {} as ReactFlowInstance<Node<TerminalNodeData>>,
          nodes: [NODE],
          updateCanvasDocument: vi.fn(),
          spaces: props.spaces,
        }),
      { initialProps: { spaces: [SPACE] }, wrapper: wrapper.Wrapper },
    )

    act(() => result.current.activateSpaceTitle('space-1', 'near'))
    expect(wrapper.recorder.current().readUi().spaceRename).not.toBeNull()

    rerender({ spaces: [] })

    expect(wrapper.recorder.current().readUi().spaceRename).toBeNull()
  })
})

describe('Space target mount picker through the canvas store', () => {
  function stubMountList(mounts: MountDto[]) {
    let resolve!: () => void
    const pending = new Promise<{ mounts: MountDto[] }>(done => {
      resolve = () => done({ mounts })
    })
    vi.stubGlobal('opencoveApi', { controlSurface: { invoke: vi.fn().mockReturnValue(pending) } })
    return resolve
  }

  it('opens the picker in the store when the mount list resolves in the same workspace', async () => {
    const resolveMounts = stubMountList([mount('mount-1'), mount('mount-2')])
    const wrapper = createWrapper('workspace-a')
    const { result } = renderSpaces({ wrapper, spaces: [], selectedNodeIds: ['node-1'] })

    act(() => result.current.createSpaceFromSelectedNodes())
    await act(async () => {
      resolveMounts()
    })

    expect(wrapper.recorder.current().readUi().spaceTargetMountPicker).toEqual(
      expect.objectContaining({ nodeIds: ['node-1'], selectedMountId: 'mount-1' }),
    )
  })

  it('does not open the picker in the new workspace when the mount list resolves after a switch', async () => {
    const resolveMounts = stubMountList([mount('mount-1'), mount('mount-2')])
    const wrapper = createWrapper('workspace-a')
    const { result, rerender } = renderSpaces({ wrapper, spaces: [], selectedNodeIds: ['node-1'] })
    const storeOfWorkspaceA = wrapper.recorder.current()

    act(() => result.current.createSpaceFromSelectedNodes())
    wrapper.switchWorkspace('workspace-b')
    rerender({ workspaceId: 'workspace-b' })
    const storeOfWorkspaceB = wrapper.recorder.current()
    expect(storeOfWorkspaceB.commands).not.toBe(storeOfWorkspaceA.commands)

    await act(async () => {
      resolveMounts()
    })

    expect(storeOfWorkspaceB.readUi().spaceTargetMountPicker).toBeNull()
    expect(wrapper.recorder.current().readUi().spaceTargetMountPicker).toBeNull()
  })

  it('closes every dialog, the picker and the rename in the first render of a new workspace', () => {
    const wrapper = createWrapper('workspace-a')
    const { rerender } = render(<wrapper.Wrapper>{null}</wrapper.Wrapper>)
    const { commands } = wrapper.recorder.current()

    act(() => {
      commands.openDialog('nodeDeleteConfirmation', {
        nodeIds: ['node-1'],
        primaryNodeKind: 'note',
        primaryNodeTitle: 'Note',
        emptyingSpaces: [],
      })
      commands.startSpaceRename('space-1', 'Space 1')
    })
    expect(wrapper.recorder.current().readUi().nodeDeleteConfirmation).not.toBeNull()

    wrapper.switchWorkspace('workspace-b')
    rerender(<wrapper.Wrapper>{null}</wrapper.Wrapper>)

    expect(wrapper.recorder.current().readUi()).toMatchObject({
      nodeDeleteConfirmation: null,
      spaceTargetMountPicker: null,
      spaceRename: null,
    })
  })
})

describe('task editor through the canvas store', () => {
  const TASK_NODE: Node<TerminalNodeData> = {
    ...NODE,
    id: 'task-1',
    data: {
      ...NODE.data,
      kind: 'task',
      title: 'Task',
      task: {
        requirement: 'Do the thing',
        status: 'todo',
        priority: 'medium',
        tags: [],
        createdAt: '',
        updatedAt: '',
        linkedAgentNodeId: null,
        lastRunAt: null,
        autoGeneratedTitle: false,
        isEnriching: false,
      },
    } as TerminalNodeData,
  }

  function setupEditor(suggestTaskTitle: () => Promise<never>) {
    const wrapper = createWrapper('workspace-a')
    const openTaskEditorRef = { current: (_nodeId: string) => undefined as void }
    const setNodes = vi.fn()
    const hook = renderHook(
      () =>
        useWorkspaceCanvasTaskEditor({
          nodesRef: { current: [TASK_NODE] },
          setNodes,
          onRequestPersistFlush: vi.fn(),
          suggestTaskTitle,
          taskTagOptions: [],
          openTaskEditorRef,
        }),
      { wrapper: wrapper.Wrapper },
    )
    return { wrapper, hook, openTaskEditorRef, setNodes }
  }

  it('opens through the store and closes through the close guard', () => {
    const { wrapper, openTaskEditorRef, hook } = setupEditor(() => new Promise(() => undefined))

    act(() => openTaskEditorRef.current('task-1'))
    expect(wrapper.recorder.current().readUi().taskEditor).toEqual(
      expect.objectContaining({ nodeId: 'task-1', requirement: 'Do the thing' }),
    )

    act(() => hook.result.current.closeTaskEditor())
    expect(wrapper.recorder.current().readUi().taskEditor).toBeNull()
  })

  it('does not close while a save is running', () => {
    const { wrapper, openTaskEditorRef, hook } = setupEditor(() => new Promise(() => undefined))

    act(() => openTaskEditorRef.current('task-1'))
    act(() =>
      wrapper.recorder
        .current()
        .commands.updateDialog('taskEditor', current => ({ ...current, isSaving: true })),
    )
    act(() => hook.result.current.closeTaskEditor())

    expect(wrapper.recorder.current().readUi().taskEditor).not.toBeNull()
  })

  it('does not reopen the editor when a save completes after the editor was closed', async () => {
    let resolveSuggestion!: (value: never) => void
    const suggestTaskTitle = vi.fn(
      () =>
        new Promise<never>(resolve => {
          resolveSuggestion = resolve
        }),
    )
    const { wrapper, openTaskEditorRef, hook, setNodes } = setupEditor(suggestTaskTitle)

    act(() => openTaskEditorRef.current('task-1'))
    act(() =>
      wrapper.recorder.current().commands.updateDialog('taskEditor', current => ({
        ...current,
        title: '',
        autoGenerateTitle: true,
      })),
    )
    let saving!: Promise<void>
    act(() => {
      saving = hook.result.current.saveTaskEdits()
    })
    expect(suggestTaskTitle).toHaveBeenCalledOnce()
    expect(wrapper.recorder.current().readUi().taskEditor?.isSaving).toBe(true)

    act(() => wrapper.recorder.current().commands.closeDialog('taskEditor'))
    await act(async () => {
      resolveSuggestion({ title: 'Generated', priority: 'high', tags: [] } as never)
      await saving
    })

    expect(wrapper.recorder.current().readUi().taskEditor).toBeNull()
    expect(setNodes).toHaveBeenCalledOnce()
  })

  it('does not reopen the editor when a title generation fails after the editor was closed', async () => {
    let rejectSuggestion!: (error: Error) => void
    const suggestTaskTitle = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectSuggestion = reject
        }),
    )
    const { wrapper, openTaskEditorRef, hook } = setupEditor(suggestTaskTitle)

    act(() => openTaskEditorRef.current('task-1'))
    let generating!: Promise<void>
    act(() => {
      generating = hook.result.current.generateTaskEditorTitle()
    })
    act(() => wrapper.recorder.current().commands.closeDialog('taskEditor'))
    await act(async () => {
      rejectSuggestion(new Error('offline'))
      await generating
    })

    expect(wrapper.recorder.current().readUi().taskEditor).toBeNull()
  })
})
