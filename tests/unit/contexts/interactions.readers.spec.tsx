import type { Mock } from 'vitest'
import { act } from '@testing-library/react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WEBSITE_WINDOW_OPEN_URL_EVENT_NAME } from '../../../src/shared/contracts/websiteWindowCanvas'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import { useWorkspaceCanvasActionBar } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasActionBarActions'
import { useWorkspaceCanvasInteractions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions'
import { useWorkspaceCanvasShortcutActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasShortcutActions'
import { useWorkspaceCanvasSelectionDraft } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectionDraft'
import { useWorkspaceCanvasSelectNode } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectNode'
import { useWorkspaceCanvasShortcuts } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts'
import {
  useCanvasUiCommands,
  useReadCanvasSelection,
  useReadCanvasUi,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import type { SelectionDraftState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import {
  createNodeHolder,
  createRowNodes,
  createSpace,
} from '../../support/canvasSelectionFixtures'
import { CREATED, lastCall } from '../../support/pushAwayCallerHarness'
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'

// Every callback that creates a node from the pane reads the Spaces of the workspace whose render
// made it, from the store, when it runs (#702, PR 7). Each case writes the Spaces of the shown
// workspace in the same call as the invocation, then shows the other workspace and does it again.
// A callback that reads the Spaces of its render, a ref, or the reader of the first render finds
// no Space, or the Space of workspace A while B is shown.
//
// Everything a callback could depend on besides the reader is stable here: the arguments are built
// once and the canvas store's own commands keep the value of the first render, so a reader that is
// missing from a dependency list cannot be hidden by another dependency that changes with the
// workspace.

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
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    assignNodeToSpaceAndExpand: vi.fn(),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts',
  () => ({ useWorkspaceCanvasShortcuts: vi.fn() }),
)

const assignMock = assignNodeToSpaceAndExpand as unknown as Mock

const WIDE = { x: -5000, y: -5000, width: 10000, height: 10000 }
const PANE_MENU = { kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 } as const
const setNodes = vi.fn()
const updateCanvasDocument = vi.fn()
const createNodeForSession = vi.fn(async () => CREATED)
const createNoteNode = vi.fn(() => CREATED)
const createWebsiteNode = vi.fn(() => CREATED)
const createImageNode = vi.fn(() => CREATED)
const metrics = { fontSize: 13 }
const canvasElement = document.createElement('div')
canvasElement.getBoundingClientRect = () =>
  ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 }) as DOMRect
const canvasRef = { current: canvasElement }
const reactFlow = {
  screenToFlowPosition: (point: { x: number; y: number }) => point,
  getNodes: () => [],
  getNode: () => undefined,
}

beforeEach(() => {
  vi.clearAllMocks()
  firstRender.values.clear()
  vi.stubGlobal('opencoveApi', {
    pty: { spawn: vi.fn(async () => ({ sessionId: 's', profileId: null, runtimeKind: 'posix' })) },
    workspace: { writeCanvasImage: vi.fn(async () => undefined) },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Pair = [WorkspaceSpaceState, WorkspaceSpaceState]

const wideSpaces = (): Pair => [createSpace('space-a', WIDE), createSpace('space-b', WIDE)]

/**
 * Runs `invoke` for workspace A and then for B, with one Space written to the shown workspace in
 * the same `act` before each call, and returns what `invoke` found each time.
 */
async function observeInBothWorkspaces<Result, Found>({
  useHook,
  invoke,
  spaces = wideSpaces(),
}: {
  useHook: () => Result
  invoke: (current: { hook: Result; ui: ReturnType<typeof useCanvasUiCommands> }) => Promise<Found>
  spaces?: Pair
}): Promise<[Found, Found]> {
  createCanvasDocumentHarness({ workspaceId: 'workspace-a' })
  useAppStore.setState(state => ({
    workspaces: [...state.workspaces, { ...state.workspaces[0], id: 'workspace-b' }],
  }))
  let shown = 'workspace-a'
  const view = renderInCanvasDocument(() => ({ ui: useCanvasUiCommands(), hook: useHook() }), {
    workspaceId: () => shown,
  })
  const found: Found[] = []
  for (const [workspaceId, space] of [
    ['workspace-a', spaces[0]],
    ['workspace-b', spaces[1]],
  ] as const) {
    if (workspaceId === 'workspace-b') {
      act(() => {
        shown = workspaceId
        view.rerender()
      })
    }
    assignMock.mockClear()
    await act(async () => {
      replaceSpacesInStore(workspaceId, [space])
      found.push(await invoke(view.result.current))
    })
  }
  return found as [Found, Found]
}

const assignedSpace = () =>
  (lastCall(assignMock)[0] as { targetSpaceId?: string } | undefined)?.targetSpaceId

async function expectsTargetOfTheRender<Result>(
  useHook: () => Result,
  invoke: (current: { hook: Result; ui: ReturnType<typeof useCanvasUiCommands> }) => unknown,
) {
  const found = await observeInBothWorkspaces({
    useHook,
    invoke: async current => {
      await invoke(current)
      await vi.waitFor(() => expect(assignMock).toHaveBeenCalled())
      return assignedSpace()
    },
  })
  expect(found).toEqual(['space-a', 'space-b'])
}

describe('the node creation callbacks of the interactions', () => {
  const paneEvent = (() => {
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    const target = document.createElement('div')
    pane.append(target)
    return { button: 0, target, clientX: 400, clientY: 300 }
  })()
  const clipboard = (text: string, items: unknown[] = []) => ({
    clipboardData: { items, files: [], getData: () => text },
    defaultPrevented: false,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  })
  const imageItem = {
    kind: 'file',
    getAsFile: () => ({
      type: 'image/png',
      size: 3,
      name: 'a.png',
      arrayBuffer: async () => new ArrayBuffer(3),
    }),
  }
  const params = {
    canvasRef,
    isTrackpadCanvasMode: false,
    focusNodeOnClick: false,
    focusNodeTargetZoom: 1,
    websiteWindowsEnabled: true,
    websiteWindowPasteEnabled: true,
    isShiftPressedRef: { current: false },
    selectionDraftRef: { current: null },
    reactFlow,
    setNodes,
    updateCanvasDocument,
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
    onShowMessage: vi.fn(),
  }
  const useInteractionsUnderTest = () => useWorkspaceCanvasInteractions(params as never)
  type Composed = ReturnType<typeof useInteractionsUnderTest>
  type Current = { hook: Composed; ui: ReturnType<typeof useCanvasUiCommands> }

  const cases: Array<[string, (current: Current) => unknown]> = [
    ['note at a flow point', ({ hook }) => hook.createNoteNodeAtFlowPoint({ x: 400, y: 300 })],
    ['website at a flow point', ({ hook }) => hook.createWebsiteNodeAtFlowPoint({ x: 4, y: 3 })],
    ['note from the pane menu', openedMenu(hook => hook.createNoteNodeFromContextMenu())],
    ['website from the pane menu', openedMenu(hook => hook.createWebsiteNodeFromContextMenu())],
    [
      'quick URL command',
      openedMenu(hook =>
        hook.runQuickCommand({ kind: 'url', url: 'https://example.com', title: 'x' } as never),
      ),
    ],
    ['quick phrase', openedMenu(hook => hook.insertQuickPhrase({ content: 'hello' } as never))],
    [
      'quick terminal command',
      openedMenu(hook =>
        hook.runQuickCommand({ kind: 'command', command: 'ls', title: 'ls' } as never),
      ),
    ],
    ['pane terminal', ({ hook }) => hook.createTerminalNodeAtFlowPoint({ x: 400, y: 300 })],
    [
      'pasted website',
      ({ hook }) => hook.handleCanvasPaste(clipboard('https://example.com') as never),
    ],
    ['pasted image', ({ hook }) => hook.handleCanvasPaste(clipboard('', [imageItem]) as never)],
    [
      'website opened from a website window',
      () =>
        window.dispatchEvent(
          new CustomEvent(WEBSITE_WINDOW_OPEN_URL_EVENT_NAME, {
            detail: { type: 'open-url', url: 'https://example.com', sourceNodeId: 'none' },
          }),
        ),
    ],
    [
      'note created by a double click',
      ({ hook }) => hook.handleCanvasDoubleClickCapture(paneEvent as never),
    ],
  ]

  function openedMenu(call: (hook: Composed) => unknown): (current: Current) => unknown {
    return ({ hook, ui }) => {
      ui.openContextMenu(PANE_MENU)
      return call(hook)
    }
  }

  it.each(cases)(
    'finds the Space of the workspace of the render for the %s',
    async (_name, run) => {
      await expectsTargetOfTheRender(useInteractionsUnderTest, run)
    },
  )

  it('resolves the anchor of the pane menu against the Spaces of the workspace of the render', async () => {
    // The pointer is 20 px right of the centre of the canvas, which is a snap target when the same
    // Space holds both points. In B a narrow Space holds the pointer and not the centre.
    const found = await observeInBothWorkspaces({
      useHook: () => ({ interactions: useInteractionsUnderTest(), readUi: useReadCanvasUi() }),
      invoke: async ({ hook }) => {
        hook.interactions.handlePaneContextMenu({
          preventDefault: vi.fn(),
          clientX: 520,
          clientY: 400,
          button: 2,
        } as never)
        const menu = hook.readUi().contextMenu
        return menu?.kind === 'pane' ? menu.creationAnchor : null
      },
      spaces: [
        createSpace('space-a', WIDE),
        createSpace('space-b', { x: 510, y: 0, width: 100, height: 1000 }),
      ],
    })
    expect(found).toEqual([
      { x: 500, y: 400 },
      { x: 520, y: 400 },
    ])
  })
})

describe('the action bar', () => {
  it('labels the drop target with the Space of the workspace of the render', async () => {
    const found = await observeInBothWorkspaces({
      useHook: () =>
        useWorkspaceCanvasActionBar({
          canvasRef,
          reactFlow: reactFlow as never,
          createAgentAtPoint: vi.fn(),
          createTerminalAtPoint: vi.fn(),
          createNoteAtPoint: vi.fn(),
          createTaskAtPoint: vi.fn(),
          createWebsiteAtPoint: vi.fn(),
          createSpaceAtPoint: vi.fn(),
          createPluginAtPoint: vi.fn(),
        }),
      invoke: async ({ hook }) => hook.resolveDropTargetLabel({ x: 400, y: 300 }),
    })
    expect(found).toEqual(['space-a', 'space-b'])
  })
})

describe('the shortcuts that create a node', () => {
  // A Space list that the hook was rendered with: the creators must not read it.
  const shortcutParams = {
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
    setNodes,
    updateCanvasDocument,
    nodeCreation: { createNodeForSession, createNoteNode },
    launchAgentAtFlowPosition: vi.fn(),
    createSpaceFromSelectedNodes: vi.fn(),
    activateSpace: vi.fn(),
    setActiveSpaceIdFromNodeNavigation: vi.fn(),
    clearNodeSelection: vi.fn(),
    onShowMessage: vi.fn(),
    terminalDisplayMetrics: metrics,
  }
  const shortcutArgs = () =>
    lastCall(useWorkspaceCanvasShortcuts)[0] as {
      createNoteAtViewportCenter: () => void
      createTerminalAtViewportCenter: () => Promise<void>
    }
  const useShortcutsUnderTest = () => useWorkspaceCanvasShortcutActions(shortcutParams as never)

  it('creates the note in the Space of the workspace of the render', async () => {
    await expectsTargetOfTheRender(useShortcutsUnderTest, () =>
      shortcutArgs().createNoteAtViewportCenter(),
    )
  })

  it('creates the terminal in the Space of the workspace of the render', async () => {
    await expectsTargetOfTheRender(useShortcutsUnderTest, () =>
      shortcutArgs().createTerminalAtViewportCenter(),
    )
  })
})

describe('the selection hooks', () => {
  // The canvas store's commands keep the value of the first render, so only the reader of the
  // render can make a callback follow the workspace shown.
  it('scopes a toggle by the Spaces of the workspace of the render', async () => {
    const holder = createNodeHolder(createRowNodes(['a', 'b', 'c'], ['a']))
    const found = await observeInBothWorkspaces({
      useHook: () => useWorkspaceCanvasSelectNode({ setNodes: holder.setNodes }),
      invoke: async ({ hook }) => {
        holder.setNodes(nodes => nodes.map(node => ({ ...node, selected: node.id === 'a' })))
        hook('c', { toggle: true })
        return holder.selectedIds
      },
      // Notes a and b are 300 wide at x 0 and 400; c is at x 800.
      spaces: [
        createSpace('space-a', { x: -50, y: -50, width: 700, height: 400 }, ['a', 'b']),
        createSpace('space-b', { x: -50, y: -50, width: 1400, height: 400 }, ['a', 'b', 'c']),
      ],
    })
    // In A the Space holds a and b but not c, so a leaves c's scope. In B it holds all three.
    expect(found).toEqual([['c'], ['a', 'c']])
  })

  // Built once: a callback that is rebuilt only for another reason would hide a missing reader.
  const marqueeNodes = createNodeHolder(createRowNodes(['a', 'b', 'c']))
  const marqueeFlow = {
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    getNodes: () => marqueeNodes.nodes as Node<TerminalNodeData>[],
  } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
  const marqueeShift = { current: false }
  function useMarquee(draftRef: { current: SelectionDraftState | null }) {
    return {
      draft: useWorkspaceCanvasSelectionDraft({
        workspaceId: 'writers',
        isTrackpadCanvasMode: true,
        isShiftPressedRef: marqueeShift,
        selectionDraftRef: draftRef,
        reactFlow: marqueeFlow,
        setNodes: marqueeNodes.setNodes,
      }),
      readSelection: useReadCanvasSelection(),
    }
  }
  const marqueePane = document.createElement('div')
  marqueePane.className = 'react-flow__pane'
  const pointerDown = (x: number, y: number) =>
    ({
      button: 0,
      shiftKey: false,
      target: marqueePane,
      clientX: x,
      clientY: y,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }) as unknown as React.PointerEvent<HTMLDivElement>

  it('starts a marquee inside the Space of the workspace of the render', async () => {
    document.body.append(marqueePane)
    const draftRef: { current: SelectionDraftState | null } = { current: null }
    const found = await observeInBothWorkspaces({
      useHook: () => useMarquee(draftRef),
      invoke: async ({ hook }) => {
        draftRef.current = null
        hook.draft.handleCanvasPointerDownCapture(pointerDown(400, 300))
        return (draftRef.current as SelectionDraftState | null)?.startSpaceId
      },
    })
    expect(found).toEqual(['space-a', 'space-b'])
    document.body.innerHTML = ''
  })

  it('selects the Space a marquee touches in the workspace of the render', async () => {
    document.body.append(marqueePane)
    const draftRef: { current: SelectionDraftState | null } = { current: null }
    const touched = (id: string) => createSpace(id, { x: 0, y: 0, width: 360, height: 260 }, ['a'])
    const found = await observeInBothWorkspaces({
      useHook: () => useMarquee(draftRef),
      invoke: async ({ hook }) => {
        draftRef.current = null
        hook.draft.handleCanvasPointerDownCapture(pointerDown(-50, -50))
        hook.draft.handleCanvasPointerUpCapture({ clientX: 350, clientY: 250 })
        return hook.readSelection().spaceIds
      },
      spaces: [touched('space-a'), touched('space-b')],
    })
    expect(found).toEqual([['space-a'], ['space-b']])
    document.body.innerHTML = ''
  })
})
