import type { Node } from '@xyflow/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WEBSITE_WINDOW_OPEN_URL_EVENT_NAME } from '../../../src/shared/contracts/websiteWindowCanvas'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import { useWorkspaceCanvasInteractions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions'
import { useWorkspaceCanvasFlowNodeCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.flowNodeCreation'
import { useWebsiteNodeContextMenuCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.websiteContextMenu'
import { useWorkspaceCanvasQuickMenuActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.quickMenuActions'
import { useWorkspaceCanvasPasteHandlers } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.pasteHandlers'
import { useWorkspaceCanvasImageImport } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasImageImport'
import { useWebsiteWindowOpenUrlNodeCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWebsiteWindowOpenUrlNodeCreation'
import { useWorkspaceCanvasShortcutActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasShortcutActions'
import { useWorkspaceCanvasShortcuts } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts'
import { useWorkspaceCanvasTerminalCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.terminalCreation'
import { createTerminalNodeAtFlowPosition } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation'
import { useWorkspaceCanvasAgentSupport } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasAgentSupport'
import { useWorkspaceCanvasRoleUi } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasRoleUi'
import { useWorkspaceCanvasTaskUi } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasTaskUi'
import { useWorkspaceCanvasAgentLauncher } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentLauncher'
import { useWorkspaceCanvasTaskNodeCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskNodeCreation'
import { useWorkspaceCanvasTaskActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions'
import {
  resumeTaskAgentSessionAction,
  runTaskAgentAction,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession'
import { assignAgentNodeToTaskSpace } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.shared'
import { useWorkspaceCanvasRoleActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions'
import {
  runRoleNodeAction,
  type RoleRunActionContext,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions.run'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  CREATED,
  OLD_CHANNELS,
  TARGET,
  expectsOneFlushAfterThePushAway,
  createdInShownDocument,
  expectsWriterOfTheRender,
  lastCall,
  expectsEveryAssignedNodeInTheDocument,
  recordAssignmentsAgainst,
  writeCreatedNode,
  type Updater,
} from '../../support/pushAwayCallerHarness'
import { createStoreBackedChannels } from '../../support/workspaceCanvasStoreHarness'
import type { WorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocument'

// Every caller of the push-away takes the document writer of the node store of the render that made
// its callback, and hands the push-away that writer and none of the old channels (#702, PR 6). A
// caller that passes a writer that does nothing, passes none, or keeps the writer of an earlier
// render lands the push-away in the wrong workspace or nowhere, and the unit specs of the callee
// cannot see it. The push-away itself is mocked: only what it is handed is checked, and a marker
// Space written through the writer must land in the workspace of the render, and in no other.

// The canvas store is rebuilt with the workspace, so `ui`, `readUi`, `readSelection` and the
// document reader change on a switch and would make every callback rebuild: the writer could then
// be missing from a dependency list unseen. These six keep the value of the first render, so only
// the writer can make a callback follow a switch. Both workspaces hold the target Space, so a
// creator still finds it through the first render's reader.
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
      useReadCanvasDocument: stable('useReadCanvasDocument'),
    }
  },
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    assignNodeToSpaceAndExpand: vi.fn(),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    createTerminalNodeAtFlowPosition: vi.fn(async () => null),
  }),
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
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts',
  () => ({ useWorkspaceCanvasShortcuts: vi.fn() }),
)

const EMPTY_DOCUMENT: WorkspaceDocument = {
  nodes: [],
  spaces: [],
  activeSpaceId: null,
  spaceArchiveRecords: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  isMinimapVisible: false,
}

const PANE_MENU = { kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 } as const

// Arguments are built once, as the canvas's are, so that a callback is rebuilt only when its own
// dependencies change and a missing writer shows.
const setNodes = vi.fn()
const onSpacesChange = vi.fn()
const onShowMessage = vi.fn()
const onRequestPersistFlush = vi.fn()
const createNodeForSession = vi.fn(async () => createdInShownDocument())
const createNoteNode = vi.fn(() => createdInShownDocument())
const createWebsiteNode = vi.fn(() => createdInShownDocument())
const createImageNode = vi.fn(() => createdInShownDocument())
const createTaskNode = vi.fn(() => createdInShownDocument())
const createRoleNode = vi.fn(() => createdInShownDocument())
const metrics = { fontSize: 13 }
const launcherSettings = { ...DEFAULT_AGENT_SETTINGS, defaultProvider: 'codex' }
const readAgentSettings = () => launcherSettings
const roleSettings = {
  ...DEFAULT_AGENT_SETTINGS,
  projectRolesByWorkspaceId: { workspace: [{ id: 'role', name: 'Role', promptTemplate: 'x' }] },
}
const buildAgentNodeTitle = () => 'Agent'
const launchAgentInNode = vi.fn()
const updateRoleProvider = vi.fn()
const updateRoleInput = vi.fn()
const appendRoleRunRecord = vi.fn()
const taskTagOptions: string[] = []
const reactFlow = { screenToFlowPosition: () => ({ x: 400, y: 300 }) }
const canvasRef = { current: document.createElement('div') }

const assignMock = assignNodeToSpaceAndExpand as unknown as Mock
const terminalMock = createTerminalNodeAtFlowPosition as unknown as Mock

const assignArgs = () => lastCall(assignMock)[0] as Record<string, unknown> | undefined
const terminalArgs = () => lastCall(terminalMock)[0] as Record<string, unknown> | undefined

beforeEach(() => {
  vi.clearAllMocks()
  firstRender.values.clear()
  // Each assignment records the node that the document held when it was called (#758).
  recordAssignmentsAgainst(assignMock)
})

describe('the push-away of the interactions as the canvas composes them', () => {
  const paneEvent = (() => {
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    const target = document.createElement('div')
    pane.append(target)
    return { button: 0, target, clientX: 400, clientY: 300 }
  })()
  const clipboard = {
    clipboardData: { items: [], files: [], getData: () => 'https://example.com' },
    defaultPrevented: false,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }
  const selectionDraftRef = { current: null }
  const isShiftPressedRef = { current: false }
  const interactionParams = {
    canvasRef,
    isTrackpadCanvasMode: false,
    focusNodeOnClick: false,
    focusNodeTargetZoom: 1,
    websiteWindowsEnabled: true,
    websiteWindowPasteEnabled: true,
    isShiftPressedRef,
    selectionDraftRef,
    reactFlow: { ...reactFlow, getNodes: () => [], getNode: () => undefined },
    workspaceId: 'workspace',
    workspacePath: '/repo',
    defaultTerminalProfileId: null,
    terminalFontSize: 13,
    terminalDisplayMetrics: metrics,
    standardWindowSizeBucket: 'regular',
    browserDefaultMode: 'iframe',
    createNodeForSession,
    createNoteNode,
    createImageNode,
    createWebsiteNode,
    onShowMessage,
  }
  const useInteractionsUnderTest = (updateCanvasDocument: Updater) =>
    useWorkspaceCanvasInteractions({ ...interactionParams, updateCanvasDocument } as never)

  it('gives the note created by a double click its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: useInteractionsUnderTest,
      invoke: ({ hook }) => hook.handleCanvasDoubleClickCapture(paneEvent as never),
      argsOf: assignArgs,
    })
  })

  type Composed = ReturnType<typeof useInteractionsUnderTest>
  type OpenMenu = (menu: typeof PANE_MENU) => void
  const composedCases: Array<[string, (hook: Composed, openMenu: OpenMenu) => unknown]> = [
    ['note at a flow point', hook => hook.createNoteNodeAtFlowPoint({ x: 400, y: 300 })],
    ['website at a flow point', hook => hook.createWebsiteNodeAtFlowPoint({ x: 400, y: 300 })],
    ['pasted website', hook => hook.handleCanvasPaste(clipboard as never)],
    [
      'note from the pane menu',
      (hook, openMenu) => {
        openMenu(PANE_MENU)
        return hook.createNoteNodeFromContextMenu()
      },
    ],
    [
      'website from the pane menu',
      (hook, openMenu) => {
        openMenu(PANE_MENU)
        return hook.createWebsiteNodeFromContextMenu()
      },
    ],
    [
      'quick URL command',
      (hook, openMenu) => {
        openMenu(PANE_MENU)
        return hook.runQuickCommand({
          kind: 'url',
          url: 'https://example.com',
          title: 'x',
        } as never)
      },
    ],
    [
      'quick phrase',
      (hook, openMenu) => {
        openMenu(PANE_MENU)
        return hook.insertQuickPhrase({ content: 'hello' } as never)
      },
    ],
    [
      'website opened from a website window',
      () =>
        window.dispatchEvent(
          new CustomEvent(WEBSITE_WINDOW_OPEN_URL_EVENT_NAME, {
            detail: { type: 'open-url', url: 'https://example.com', sourceNodeId: 'none' },
          }),
        ),
    ],
  ]

  it.each(composedCases)('gives the %s its workspace writer', async (_name, invokeOn) => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: useInteractionsUnderTest,
      invoke: ({ hook, ui }) => invokeOn(hook, ui.openContextMenu),
      argsOf: assignArgs,
    })
  })

  it('gives the pane terminal its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: useInteractionsUnderTest,
      invoke: ({ hook }) => hook.createTerminalNodeAtFlowPoint({ x: 1, y: 2 }),
      argsOf: terminalArgs,
    })
  })
})

describe('the push-away of the interaction callers', () => {
  const flowParams = {
    workspaceId: 'workspace',
    standardWindowSizeBucket: 'regular',
    createNoteNode,
    createWebsiteNode,
    browserDefaultMode: 'iframe',
    websiteWindowsEnabled: true,
    onSpacesChange,
  }

  it('gives the note at a flow point its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasFlowNodeCreation({ ...flowParams, updateCanvasDocument } as never),
      invoke: ({ hook }) => hook.createNoteNodeAtFlowPoint({ x: 400, y: 300 }),
      argsOf: assignArgs,
    })
  })

  it('gives the website at a flow point its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasFlowNodeCreation({ ...flowParams, updateCanvasDocument } as never),
      invoke: ({ hook }) => hook.createWebsiteNodeAtFlowPoint({ x: 400, y: 300 }),
      argsOf: assignArgs,
    })
  })

  it('gives the note from the pane menu its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasFlowNodeCreation({ ...flowParams, updateCanvasDocument } as never),
      invoke: ({ hook, ui }) => {
        ui.openContextMenu(PANE_MENU)
        return hook.createNoteNodeFromContextMenu()
      },
      argsOf: assignArgs,
    })
  })

  it('gives the website from the pane menu its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWebsiteNodeContextMenuCreation({ ...flowParams, updateCanvasDocument } as never),
      invoke: ({ hook, ui }) => {
        ui.openContextMenu(PANE_MENU)
        return hook()
      },
      argsOf: assignArgs,
    })
  })

  const quickParams = {
    ...flowParams,
    defaultTerminalProfileId: null,
    terminalFontSize: 13,
    terminalDisplayMetrics: metrics,
    workspacePath: '/repo',
    createNodeForSession,
    onShowMessage,
  }

  it('gives the quick URL command its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasQuickMenuActions({ ...quickParams, updateCanvasDocument } as never),
      invoke: ({ hook, ui }) => {
        ui.openContextMenu(PANE_MENU)
        return hook.runQuickCommand({
          kind: 'url',
          url: 'https://example.com',
          title: 'x',
        } as never)
      },
      argsOf: assignArgs,
    })
  })

  it('gives the quick phrase its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasQuickMenuActions({ ...quickParams, updateCanvasDocument } as never),
      invoke: ({ hook, ui }) => {
        ui.openContextMenu(PANE_MENU)
        return hook.insertQuickPhrase({ content: 'hello' } as never)
      },
      argsOf: assignArgs,
    })
  })

  it('gives the quick terminal command its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasQuickMenuActions({ ...quickParams, updateCanvasDocument } as never),
      invoke: ({ hook, ui }) => {
        ui.openContextMenu(PANE_MENU)
        return hook.runQuickCommand({ kind: 'command', command: 'ls', title: 'ls' } as never)
      },
      argsOf: terminalArgs,
    })
  })

  it('gives the pane terminal creation its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasTerminalCreation({
          ...flowParams,
          workspacePath: '/repo',
          defaultTerminalProfileId: null,
          terminalFontSize: 13,
          terminalDisplayMetrics: metrics,
          createNodeForSession,
          onShowMessage,
          updateCanvasDocument,
        } as never),
      invoke: ({ hook }) => hook.createTerminalNodeAtFlowPoint({ x: 1, y: 2 }),
      argsOf: terminalArgs,
    })
  })

  it('gives the pasted website its workspace writer', async () => {
    const event = {
      clipboardData: { items: [], files: [], getData: () => 'https://example.com' },
      defaultPrevented: false,
      target: document.createElement('div'),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasPasteHandlers({
          ...flowParams,
          canvasRef,
          reactFlow,
          createImageNode,
          websiteWindowPasteEnabled: true,
          updateCanvasDocument,
        } as never),
      invoke: ({ hook }) => hook.handleCanvasPaste(event as never),
      argsOf: assignArgs,
    })
  })

  it('gives the website opened from a website window its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWebsiteWindowOpenUrlNodeCreation({
          ...flowParams,
          canvasRef,
          reactFlow,
          enabled: true,
          updateCanvasDocument,
        } as never),
      invoke: () =>
        window.dispatchEvent(
          new CustomEvent(WEBSITE_WINDOW_OPEN_URL_EVENT_NAME, {
            detail: { type: 'open-url', url: 'https://example.com', sourceNodeId: 'none' },
          }),
        ),
      argsOf: assignArgs,
    })
  })

  describe('imported images', () => {
    const imageEvent = {
      clipboardData: {
        items: [
          {
            kind: 'file',
            getAsFile: () => ({
              type: 'image/png',
              size: 3,
              name: 'a.png',
              arrayBuffer: async () => new ArrayBuffer(3),
            }),
          },
        ],
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }

    it('gives the imported image its workspace writer', async () => {
      const api = window as unknown as { opencoveApi?: Record<string, unknown> }
      api.opencoveApi = { workspace: { writeCanvasImage: vi.fn(async () => undefined) } }
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument =>
          useWorkspaceCanvasImageImport({
            workspaceId: 'workspace',
            canvasRef,
            reactFlow,
            setNodes,
            onSpacesChange,
            createImageNode,
            standardWindowSizeBucket: 'regular',
            updateCanvasDocument,
          } as never),
        invoke: async ({ hook }) => {
          const before = assignMock.mock.calls.length
          hook.handleCanvasPaste(imageEvent as never)
          await vi.waitFor(() => expect(assignMock.mock.calls.length).toBeGreaterThan(before))
        },
        argsOf: assignArgs,
      })
    })
  })

  it('gives the image pasted through the paste handlers its workspace writer', async () => {
    const api = window as unknown as { opencoveApi?: Record<string, unknown> }
    api.opencoveApi = { workspace: { writeCanvasImage: vi.fn(async () => undefined) } }
    const imageEvent = {
      clipboardData: {
        items: [
          {
            kind: 'file',
            getAsFile: () => ({
              type: 'image/png',
              size: 3,
              name: 'a.png',
              arrayBuffer: async () => new ArrayBuffer(3),
            }),
          },
        ],
        files: [],
        getData: () => '',
      },
      defaultPrevented: false,
      target: document.createElement('div'),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasPasteHandlers({
          ...flowParams,
          canvasRef,
          reactFlow,
          createImageNode,
          websiteWindowPasteEnabled: true,
          updateCanvasDocument,
        } as never),
      invoke: async ({ hook }) => {
        const before = assignMock.mock.calls.length
        hook.handleCanvasPaste(imageEvent as never)
        await vi.waitFor(() => expect(assignMock.mock.calls.length).toBeGreaterThan(before))
      },
      argsOf: assignArgs,
    })
  })

  describe('the shortcuts', () => {
    function shortcutParams(updateCanvasDocument: Updater) {
      return {
        closeNode: vi.fn(),
        enabled: true,
        workspaceId: 'workspace',
        activeSpaceId: null,
        spaces: [],
        agentSettings: DEFAULT_AGENT_SETTINGS,
        workspacePath: '/repo',
        canvasRef,
        reactFlow,
        spaceNavigationAnchorIdRef: { current: null },
        onSpacesChange,
        updateCanvasDocument,
        nodeCreation: { createNodeForSession, createNoteNode },
        launchAgentAtFlowPosition: vi.fn(),
        createSpaceFromSelectedNodes: vi.fn(),
        activateSpace: vi.fn(),
        setActiveSpaceIdFromNodeNavigation: vi.fn(),
        clearNodeSelection: vi.fn(),
        onShowMessage,
        terminalDisplayMetrics: metrics,
      } as never
    }
    const shortcutArgs = () =>
      lastCall(useWorkspaceCanvasShortcuts)[0] as {
        createNoteAtViewportCenter: () => void
        createTerminalAtViewportCenter: () => Promise<void>
      }

    it('gives the note shortcut its workspace writer', async () => {
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument =>
          useWorkspaceCanvasShortcutActions(shortcutParams(updateCanvasDocument)),
        invoke: () => shortcutArgs().createNoteAtViewportCenter(),
        argsOf: assignArgs,
      })
    })

    it('gives the terminal shortcut its workspace writer', async () => {
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument =>
          useWorkspaceCanvasShortcutActions(shortcutParams(updateCanvasDocument)),
        invoke: () => shortcutArgs().createTerminalAtViewportCenter(),
        argsOf: terminalArgs,
      })
    })
  })
})

describe('the push-away of the task and role callers', () => {
  it('gives the task created at a point its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasTaskNodeCreation({
          workspaceId: 'workspace',
          setNodes,
          onSpacesChange,
          standardWindowSizeBucket: 'regular',
          createTaskNode,
          updateCanvasDocument,
        } as never),
      invoke: ({ hook }) => hook.createTaskAtPoint({ x: 400, y: 300 }),
      argsOf: assignArgs,
      flush: 'document',
    })
  })

  describe('the task agent', () => {
    const taskRefs = () => ({
      runTaskAgentRef: { current: vi.fn() },
      resumeTaskAgentSessionRef: { current: vi.fn() },
      removeTaskAgentSessionRecordRef: { current: vi.fn() },
      updateTaskStatusRef: { current: vi.fn() },
      quickUpdateTaskTitleRef: { current: vi.fn() },
      quickUpdateTaskRequirementRef: { current: vi.fn() },
    })
    function useTaskActionsUnderTest(
      updateCanvasDocument: Updater,
      refs: ReturnType<typeof taskRefs>,
    ) {
      return useWorkspaceCanvasTaskActions({
        setNodes,
        onSpacesChange,
        createNodeForSession,
        buildAgentNodeTitle,
        launchAgentInNode,
        agentSettings: DEFAULT_AGENT_SETTINGS,
        workspaceId: 'workspace',
        workspacePath: '/repo',
        taskTagOptions,
        terminalDisplayMetrics: metrics,
        updateCanvasDocument,
        ...refs,
      } as never)
    }

    it('gives the task run its workspace writer', async () => {
      const refs = taskRefs()
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument => useTaskActionsUnderTest(updateCanvasDocument, refs),
        invoke: () => refs.runTaskAgentRef.current('task' as never),
        argsOf: () => lastCall(runTaskAgentAction)[1] as Record<string, unknown> | undefined,
        absent: ['onSpacesChange'],
      })
    })

    it('gives the task resume its workspace writer', async () => {
      const refs = taskRefs()
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument => useTaskActionsUnderTest(updateCanvasDocument, refs),
        invoke: () => refs.resumeTaskAgentSessionRef.current('task' as never, 'record' as never),
        argsOf: () =>
          lastCall(resumeTaskAgentSessionAction)[2] as Record<string, unknown> | undefined,
        absent: ['onSpacesChange'],
      })
    })

    it('hands the push-away the writer of the task context', () => {
      const updateCanvasDocument = vi.fn()
      const taskNode = { ...CREATED, id: 'task' } as Node<TerminalNodeData>
      assignAgentNodeToTaskSpace({
        taskNodeId: 'task',
        assignedNodeId: 'agent',
        context: {
          workspaceId: 'workspace',
          readDocument: createStoreBackedChannels({
            workspaceId: 'workspace',
            spaces: [{ ...TARGET, nodeIds: [taskNode.id] }],
          }).readDocument,
          updateCanvasDocument,
        } as never,
      })
      expect(assignMock).toHaveBeenCalledTimes(1)
      const args = assignArgs()!
      expect(args.updateCanvasDocument).toBe(updateCanvasDocument)
      expect(args).toMatchObject({ createdNodeId: 'agent', targetSpaceId: 'target' })
      for (const channel of OLD_CHANNELS) {
        expect(Object.keys(args)).not.toContain(channel)
      }
    })
  })

  describe('the role', () => {
    // Built once, as the canvas's reader is: a new reader on every render would rebuild every
    // callback that lists it, and hide a writer missing from the same list.
    const readRoleDocument = () => ({ ...EMPTY_DOCUMENT, spaces: [TARGET] })

    function makeActionRefs() {
      return new Proxy(
        {},
        {
          get(target: Record<string, unknown>, key: string) {
            return (target[key] ??= { current: vi.fn() })
          },
        },
      ) as unknown as Record<string, { current: Mock }>
    }

    function useRoleActionsUnderTest(
      updateCanvasDocument: Updater,
      actionRefs: Record<string, { current: Mock }>,
    ) {
      return useWorkspaceCanvasRoleActions({
        workspaceId: 'workspace',
        workspacePath: '/repo',
        agentSettings: roleSettings,
        readDocument: readRoleDocument,
        setNodes,
        onSpacesChange,
        onShowMessage,
        standardWindowSizeBucket: 'regular',
        createRoleNode,
        createNodeForSession,
        updateRoleProvider,
        updateRoleInput,
        appendRoleRunRecord,
        actionRefs,
        buildAgentNodeTitle,
        updateCanvasDocument,
      } as never)
    }

    it('gives the role created from the pane menu its workspace writer', async () => {
      const actionRefs = makeActionRefs()
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument => useRoleActionsUnderTest(updateCanvasDocument, actionRefs),
        invoke: ({ hook, ui }) => {
          ui.openContextMenu(PANE_MENU)
          return hook.runProjectRoleFromContextMenu('role')
        },
        argsOf: assignArgs,
        flush: 'document',
      })
    })

    it('gives the role run its workspace writer', async () => {
      const actionRefs = makeActionRefs()
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument => useRoleActionsUnderTest(updateCanvasDocument, actionRefs),
        invoke: () => actionRefs.runRoleRef.current('role'),
        argsOf: () => lastCall(runRoleNodeAction)[2] as Record<string, unknown> | undefined,
        absent: ['onSpacesChange'],
      })
    })

    it('hands the push-away the writer of the role run context', async () => {
      const actual = await vi.importActual<
        typeof import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions.run')
      >(
        '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions.run',
      )
      const updateCanvasDocument = vi.fn()
      const roleNode = {
        id: 'role-node',
        position: { x: 0, y: 0 },
        data: {
          kind: 'role',
          width: 100,
          height: 100,
          role: { roleId: 'role', input: 'do it', selectedProvider: null, runHistory: [] },
        },
      } as unknown as Node<TerminalNodeData>
      const { readDocument } = createStoreBackedChannels({
        workspaceId: 'workspace',
        nodes: [roleNode],
        spaces: [{ ...TARGET, nodeIds: ['role-node'] }],
      })
      recordAssignmentsAgainst(assignMock, readDocument)
      const context = {
        workspaceId: 'workspace',
        workspacePath: '/repo',
        agentSettings: DEFAULT_AGENT_SETTINGS,
        projectRoles: [{ id: 'role', name: 'Role', promptTemplate: 'x', outputFormat: '' }],
        readDocument,
        // The flush rides on the write that records the run, as the node store takes it.
        setNodes: vi.fn((_updater, options) => {
          if (options?.flush) {
            onRequestPersistFlush()
          }
        }),
        updateCanvasDocument,
        updateSpaces: vi.fn(),
        // The creator of the node store adds the node to the document before it returns it.
        createNodeForSession: vi.fn(async () => writeCreatedNode('workspace', CREATED)),
        updateRoleInput: vi.fn(),
        appendRoleRunRecord: vi.fn(),
        buildAgentNodeTitle: () => 'Role',
        t: (key: string) => key,
      } as unknown as RoleRunActionContext
      await actual.runRoleNodeAction('role-node', 'do it', context)

      // The run flushes once, after the push-away.
      expectsOneFlushAfterThePushAway(onRequestPersistFlush, 1, assignMock)
      expect(assignMock).toHaveBeenCalledTimes(1)
      expectsEveryAssignedNodeInTheDocument(assignMock)
      const args = assignArgs()!
      expect(args.updateCanvasDocument).toBe(updateCanvasDocument)
      for (const channel of OLD_CHANNELS) {
        expect(Object.keys(args)).not.toContain(channel)
      }
    })
  })
})

// The hooks that carry the writer from the canvas to the callers above: a carrier that passes a
// writer that does nothing, none, or one of an earlier render fails here, not only in E2E.
describe('the push-away through the carriers of the canvas', () => {
  it('gives the role of the role UI its workspace writer', async () => {
    const actionRefs = new Proxy(
      {},
      {
        get(target: Record<string, unknown>, key: string) {
          return (target[key] ??= { current: vi.fn() })
        },
      },
    )
    const agentSupport = { buildAgentNodeTitle }
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasRoleUi({
          workspaceId: 'workspace',
          workspacePath: '/repo',
          agentSettings: roleSettings,
          nodeStore: {
            setNodes,
            updateCanvasDocument,
            createRoleNode,
            createNodeForSession,
            updateRoleProvider,
            updateRoleInput,
            appendRoleRunRecord,
          },
          agentSupport,
          onShowMessage,
          actionRefs,
        } as never),
      invoke: ({ hook, ui }) => {
        ui.openContextMenu(PANE_MENU)
        return hook.runProjectRoleFromContextMenu('role')
      },
      argsOf: assignArgs,
      flush: 'document',
    })
  })

  describe('the task UI', () => {
    const makeActionRefs = () =>
      new Proxy(
        {},
        {
          get(target: Record<string, unknown>, key: string) {
            return (target[key] ??= { current: vi.fn() })
          },
        },
      ) as unknown as Record<string, { current: Mock }>
    const useTaskUiUnderTest = (
      updateCanvasDocument: Updater,
      actionRefs: Record<string, { current: Mock }>,
    ) =>
      useWorkspaceCanvasTaskUi({
        agentTaskTagOptions: taskTagOptions,
        updateCanvasDocument,
        setNodes,
        createNodeForSession,
        buildAgentNodeTitle,
        launchAgentInNode,
        agentSettings: DEFAULT_AGENT_SETTINGS,
        workspaceId: 'workspace',
        workspacePath: '/repo',
        actionRefs,
        terminalDisplayMetrics: metrics,
        standardWindowSizeBucket: 'regular',
        createTaskNode,
        closeNode: vi.fn(),
      } as never)

    it('gives the task created at a point its workspace writer', async () => {
      const actionRefs = makeActionRefs()
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument => useTaskUiUnderTest(updateCanvasDocument, actionRefs),
        invoke: ({ hook }) => hook.createTaskAtPoint({ x: 400, y: 300 }),
        argsOf: assignArgs,
        flush: 'document',
      })
    })

    it('gives the task run its workspace writer', async () => {
      const actionRefs = makeActionRefs()
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument => useTaskUiUnderTest(updateCanvasDocument, actionRefs),
        invoke: () => actionRefs.runTaskAgentRef.current('task'),
        argsOf: () => lastCall(runTaskAgentAction)[1] as Record<string, unknown> | undefined,
        absent: ['onSpacesChange'],
      })
    })
  })

  it('gives the launched agent of the agent support its workspace writer', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasAgentSupport({
          bumpAgentLaunchToken: () => 1,
          isAgentLaunchTokenCurrent: () => true,
          readAgentSettings,
          readTerminalDisplayCalibration: () => null,
          workspaceId: 'workspace',
          workspacePath: '/repo',
          updateCanvasDocument,
          onShowMessage,
          createNodeForSession,
        } as never),
      invoke: ({ hook }) => hook.launchAgentAtFlowPosition({ x: 400, y: 300 }),
      argsOf: assignArgs,
      flush: 'document',
    })
  })
})

describe('the push-away of the agent launcher', () => {
  it('gives the launched agent its workspace writer and flushes once after it', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasAgentLauncher({
          readAgentSettings,
          workspaceId: 'workspace',
          workspacePath: '/repo',
          onShowMessage,
          createNodeForSession,
          buildAgentNodeTitle,
          updateCanvasDocument,
        } as never),
      invoke: ({ hook }) => hook.launchAgentAtFlowPosition({ x: 400, y: 300 }),
      argsOf: assignArgs,
      flush: 'document',
    })
  })
})
