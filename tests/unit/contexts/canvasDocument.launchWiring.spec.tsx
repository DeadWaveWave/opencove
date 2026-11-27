import { act } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { useWorkspaceCanvasRoleActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions'
import { runRoleNodeAction } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions.run'
import { useWorkspaceCanvasAgentLauncher } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentLauncher'
import { resolveWorkspaceAgentLaunchBinding } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
import { useWorkspaceCanvasTaskActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions'
import {
  resumeTaskAgentSessionAction,
  runTaskAgentAction,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession'
import { createTerminalNodeAtFlowPosition } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation'
import { useWorkspaceCanvasTerminalCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.terminalCreation'
import { useWorkspaceCanvasQuickMenuActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.quickMenuActions'
import { useWorkspaceCanvasShortcutActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasShortcutActions'
import { useWorkspaceCanvasShortcuts } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts'
import {
  useCanvasUiCommands,
  type CanvasDocumentCommands,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { readWorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'

// The callers of the mount repair and of the launch binding take the Spaces writer from the
// document commands of the render that made their callback. A caller that passes a writer that
// does nothing, passes none, or keeps the commands of an earlier render loses the repair silently
// (#702). The functions below the hooks are mocked: only the writer they are handed is checked.

// The canvas store is rebuilt with the workspace, so `ui`, `readUi`, `readSelection` and the
// document reader change on a switch and would make every callback rebuild: the commands could
// then be missing from a dependency list unseen. These four keep the value of the first render, so
// only the document commands can make a callback follow a switch.
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
      useReadCanvasUi: stable('useReadCanvasUi'),
      useReadCanvasSelection: stable('useReadCanvasSelection'),
      useReadCanvasDocument: stable('useReadCanvasDocument'),
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession',
  () => ({ runTaskAgentAction: vi.fn(), resumeTaskAgentSessionAction: vi.fn() }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions.run',
  async importOriginal => ({ ...(await importOriginal<object>()), runRoleNodeAction: vi.fn() }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    createTerminalNodeAtFlowPosition: vi.fn(async () => null),
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
    launchWorkspaceAgentSession: vi.fn(async () => {
      throw new Error('stop after the binding')
    }),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts',
  () => ({ useWorkspaceCanvasShortcuts: vi.fn() }),
)

const PANE_MENU = { kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 } as const

// Arguments are built once, as the canvas's are, so that a callback is rebuilt only when its own
// dependencies change and a missing `documentCommands` shows.
const nodesRef = { current: [] }
const spacesRef = { current: [] }
const setNodes = vi.fn()
const onSpacesChange = vi.fn()
const onShowMessage = vi.fn()
const createNodeForSession = vi.fn()
const metrics = { fontSize: 13 }
const noopRef = () => ({ current: vi.fn() })
const actionRefs = new Proxy(
  {},
  {
    get(target: Record<string, unknown>, key: string) {
      return (target[key] ??= { current: vi.fn() })
    },
  },
) as never
const taskRefs = {
  runTaskAgentRef: noopRef(),
  resumeTaskAgentSessionRef: noopRef(),
  removeTaskAgentSessionRecordRef: noopRef(),
  updateTaskStatusRef: noopRef(),
  quickUpdateTaskTitleRef: noopRef(),
  quickUpdateTaskRequirementRef: noopRef(),
}

function renderWithWorkspaces<Result>(useHook: () => Result) {
  let shown = 'workspace-a'
  const view = renderInCanvasDocument(
    () => ({
      ui: useCanvasUiCommands(),
      hook: useHook(),
    }),
    { workspaceId: () => shown },
  )
  return {
    view,
    switchTo(workspaceId: string) {
      act(() => {
        shown = workspaceId
        view.rerender()
      })
    },
  }
}

// Calls `invoke` for workspace A, then for B after a switch. `writerOf` reads the writer that the
// mocked callee was handed in its last call; it is used to add a marker Space, which must land in
// the workspace of the render that made the callback and in no other. (The commands of two hook
// calls are two objects, so the writers are compared by what they write, not by identity.)
async function expectsWriterOfTheRender<Result>({
  useHook,
  invoke,
  writerOf,
}: {
  useHook: () => Result
  invoke: (current: {
    hook: Result
    ui: ReturnType<typeof useCanvasUiCommands>
  }) => unknown | Promise<unknown>
  writerOf: () => unknown
}) {
  createCanvasDocumentHarness({ workspaceId: 'workspace-a' })
  useAppStore.setState(state => ({
    workspaces: [...state.workspaces, { ...state.workspaces[0], id: 'workspace-b' }],
  }))
  const { view, switchTo } = renderWithWorkspaces(useHook)
  const markedIds = (workspaceId: string) =>
    readWorkspaceDocument(workspaceId)?.spaces.map(s => s.id)

  const mark = (id: string): WorkspaceSpaceState => ({
    id,
    name: id,
    directoryPath: '/repo',
    targetMountId: null,
    labelColor: null,
    nodeIds: [],
    rect: null,
  })
  const write = (id: string) => {
    const writer = writerOf() as CanvasDocumentCommands['updateSpaces'] | undefined
    expect(writer).toEqual(expect.any(Function))
    act(() => {
      writer!(spaces => [...spaces, mark(id)])
    })
  }

  await act(async () => {
    await invoke(view.result.current)
  })
  write('marker-a')
  expect(markedIds('workspace-a')).toEqual(['marker-a'])
  expect(markedIds('workspace-b')).toEqual([])

  switchTo('workspace-b')
  await act(async () => {
    await invoke(view.result.current)
  })
  write('marker-b')
  expect(markedIds('workspace-a')).toEqual(['marker-a'])
  expect(markedIds('workspace-b')).toEqual(['marker-b'])
}

function lastCall(mock: unknown): unknown[] {
  const calls = (mock as Mock).mock.calls
  return calls[calls.length - 1] ?? []
}

describe('the writer that launch callers hand to the mount repair and the binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firstRender.values.clear()
  })

  const taskParams = () =>
    ({
      onSpacesChange,
      setNodes,
      createNodeForSession,
      buildAgentNodeTitle: () => 'Agent',
      launchAgentInNode: vi.fn(),
      agentSettings: DEFAULT_AGENT_SETTINGS,
      workspaceId: 'workspace',
      workspacePath: '/repo',
      taskTagOptions: [],
      terminalDisplayMetrics: metrics,
      ...taskRefs,
    }) as unknown as Parameters<typeof useWorkspaceCanvasTaskActions>[0]
  const stableTaskParams = taskParams()

  it('gives the task run its workspace commands', async () => {
    await expectsWriterOfTheRender({
      useHook: () => useWorkspaceCanvasTaskActions(stableTaskParams),
      invoke: () => taskRefs.runTaskAgentRef.current('task'),
      writerOf: () =>
        (lastCall(runTaskAgentAction)[1] as { updateSpaces: unknown } | undefined)?.updateSpaces,
    })
  })

  it('gives the task resume its workspace commands', async () => {
    await expectsWriterOfTheRender({
      useHook: () => useWorkspaceCanvasTaskActions(stableTaskParams),
      invoke: () => taskRefs.resumeTaskAgentSessionRef.current('task', 'record'),
      writerOf: () =>
        (lastCall(resumeTaskAgentSessionAction)[2] as { updateSpaces: unknown } | undefined)
          ?.updateSpaces,
    })
  })

  it('gives the role run its workspace commands', async () => {
    const params = {
      workspaceId: 'workspace',
      workspacePath: '/repo',
      agentSettings: DEFAULT_AGENT_SETTINGS,
      readDocument: vi.fn(),
      setNodes,
      onSpacesChange,
      onShowMessage,
      standardWindowSizeBucket: 'regular',
      createRoleNode: vi.fn(),
      createNodeForSession,
      updateRoleProvider: vi.fn(),
      updateRoleInput: vi.fn(),
      appendRoleRunRecord: vi.fn(),
      actionRefs,
      buildAgentNodeTitle: () => 'Role',
    } as unknown as Parameters<typeof useWorkspaceCanvasRoleActions>[0]
    await expectsWriterOfTheRender({
      useHook: () => useWorkspaceCanvasRoleActions(params),
      invoke: () =>
        (
          actionRefs as unknown as { runRoleRef: { current: (id: string) => Promise<void> } }
        ).runRoleRef.current('role'),
      writerOf: () =>
        (lastCall(runRoleNodeAction)[2] as { updateSpaces: unknown } | undefined)?.updateSpaces,
    })
  })

  it('gives the agent launcher its workspace commands', async () => {
    const params = {
      readAgentSettings: () => DEFAULT_AGENT_SETTINGS,
      workspaceId: 'workspace',
      workspacePath: '/repo',
      setNodes,
      onSpacesChange,
      onShowMessage,
      createNodeForSession,
      buildAgentNodeTitle: () => 'Agent',
    } as unknown as Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]
    await expectsWriterOfTheRender({
      useHook: () => useWorkspaceCanvasAgentLauncher(params),
      invoke: ({ hook }) => hook.launchAgentAtFlowPosition({ x: 1, y: 2 }),
      writerOf: () =>
        (lastCall(resolveWorkspaceAgentLaunchBinding)[0] as { updateSpaces: unknown } | undefined)
          ?.updateSpaces,
    })
  })

  const terminalWriter = () =>
    (lastCall(createTerminalNodeAtFlowPosition)[0] as { updateSpaces: unknown } | undefined)
      ?.updateSpaces

  it('gives the pane terminal creation its workspace commands', async () => {
    const params = {
      workspaceId: 'workspace',
      spacesRef,
      workspacePath: '/repo',
      defaultTerminalProfileId: null,
      nodesRef,
      standardWindowSizeBucket: 'regular',
      terminalFontSize: 13,
      terminalDisplayMetrics: metrics,
      createNodeForSession,
      setNodes,
      onSpacesChange,
      onShowMessage,
    } as unknown as Parameters<typeof useWorkspaceCanvasTerminalCreation>[0]
    await expectsWriterOfTheRender({
      useHook: () => useWorkspaceCanvasTerminalCreation(params),
      invoke: ({ hook }) => hook.createTerminalNodeAtFlowPoint({ x: 1, y: 2 }),
      writerOf: terminalWriter,
    })
  })

  it('gives the quick command its workspace commands', async () => {
    const params = {
      workspaceId: 'workspace',
      websiteWindowsEnabled: false,
      standardWindowSizeBucket: 'regular',
      browserDefaultMode: 'iframe',
      createWebsiteNode: vi.fn(),
      createNoteNode: vi.fn(),
      spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
      defaultTerminalProfileId: null,
      terminalFontSize: 13,
      terminalDisplayMetrics: metrics,
      workspacePath: '/repo',
      createNodeForSession,
      onShowMessage,
    } as unknown as Parameters<typeof useWorkspaceCanvasQuickMenuActions>[0]
    await expectsWriterOfTheRender({
      useHook: () => useWorkspaceCanvasQuickMenuActions(params),
      // Running a command closes the pane menu, so it is opened again for each call.
      invoke: ({ hook, ui }) => {
        ui.openContextMenu(PANE_MENU)
        return hook.runQuickCommand({ kind: 'command', command: 'ls', title: 'ls' } as never)
      },
      writerOf: terminalWriter,
    })
  })

  it('gives the terminal shortcut its workspace commands', async () => {
    const canvas = document.createElement('div')
    const params = {
      closeNode: vi.fn(),
      enabled: true,
      workspaceId: 'workspace',
      activeSpaceId: null,
      spaces: [],
      agentSettings: DEFAULT_AGENT_SETTINGS,
      workspacePath: '/repo',
      canvasRef: { current: canvas },
      reactFlow: { screenToFlowPosition: (point: unknown) => point },
      spaceNavigationAnchorIdRef: { current: null },
      onSpacesChange,
      nodeCreation: { createNodeForSession, createNoteNode: vi.fn() },
      launchAgentAtFlowPosition: vi.fn(),
      createSpaceFromSelectedNodes: vi.fn(),
      activateSpace: vi.fn(),
      setActiveSpaceIdFromNodeNavigation: vi.fn(),
      clearNodeSelection: vi.fn(),
      onShowMessage,
      terminalDisplayMetrics: metrics,
    } as unknown as Parameters<typeof useWorkspaceCanvasShortcutActions>[0]
    await expectsWriterOfTheRender({
      useHook: () => useWorkspaceCanvasShortcutActions(params),
      invoke: () =>
        (
          lastCall(useWorkspaceCanvasShortcuts)[0] as {
            createTerminalAtViewportCenter: () => Promise<void>
          }
        ).createTerminalAtViewportCenter(),
      writerOf: terminalWriter,
    })
  })
})
