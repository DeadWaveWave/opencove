import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { ApplicationShortcutEvent } from '../../../src/shared/contracts/applicationShortcut'
import { publishWorkspaceNodeCreated } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCreationEvents'
import { useWorkspaceCanvasShortcutActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasShortcutActions'
import { useWorkspaceCanvasShortcuts } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts'
import { useWorkspaceCanvasCreationActivation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCreationActivation'
import { useCanvasSelectionCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import {
  replaceWorkspaceNodes,
  replaceWorkspaceSpaces,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'
import { pixelNode } from './workspacePixelLayer.fixtures'

// The shortcuts, the close-selected-node shortcut and the creation activation read the committed
// nodes and Spaces of the workspace whose render made them, from the store, when they run (#702,
// PR 8). Each case writes the store in the same call as the read, or shows another workspace:
// a read of a ref, a prop, React Flow or the canvas view gives another answer.
//
// The canvas store's own values keep the value of the first render, so only the document reader
// can make a callback or an effect follow the workspace shown. A reader that is missing from a
// dependency list, or frozen to the first render, then reads the first workspace after a switch.
// A switch moves the app store's active workspace too, as in the app; the cases that only move
// the active workspace pin the read to the workspace of the render and not the one displayed.

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
// `t` must keep its identity: a new one on every render would re-subscribe the close shortcut and
// hide a reader that is missing from its dependency list.
const translation = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => translation }))
// The selection write of the node navigation has its own reader, which changes with the workspace
// and would rebuild `navigateNode` on a switch. It is replaced by a stable function so that only
// the reader of the navigation itself can make the callback follow the switch.
const selectNode = vi.hoisted(() => vi.fn())
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectNode',
  () => ({ useWorkspaceCanvasSelectNode: () => selectNode }),
)

const WORKSPACE_A = 'workspace-a'
const WORKSPACE_B = 'workspace-b'

interface WorkspaceContent {
  nodes?: Node<TerminalNodeData>[]
  spaces?: WorkspaceSpaceState[]
}

function seedTwoWorkspaces(a: WorkspaceContent, b: WorkspaceContent) {
  createCanvasDocumentHarness({ workspaceId: WORKSPACE_A, ...a })
  useAppStore.setState(state => ({
    workspaces: [
      ...state.workspaces,
      { ...state.workspaces[0], id: WORKSPACE_B, nodes: [], spaces: [], ...b },
    ],
  }))
}

let shown = WORKSPACE_A

/** Shows `workspaceId`: the provider and the app store's active workspace move together. */
function showWorkspace(rerender: () => void, workspaceId: string) {
  act(() => {
    shown = workspaceId
    useAppStore.setState({ activeWorkspaceId: workspaceId })
    rerender()
  })
}

const agentNode = (id: string, status: TerminalNodeData['status']): Node<TerminalNodeData> => ({
  ...pixelNode({ kind: 'agent', status }),
  id,
})

/** A note at a fixed place right of the centre of the default viewport (720, 450). */
const noteAt = (id: string, x = 1000, y = 400): Node<TerminalNodeData> => ({
  ...createRowNodes([id])[0],
  position: { x, y },
})

const RIGHT_OF_CENTER = { x: 1000, y: 0, width: 300, height: 900 }

let listener: (event: ApplicationShortcutEvent) => void = () => undefined

beforeEach(() => {
  firstRender.values.clear()
  selectNode.mockClear()
  shown = WORKSPACE_A
  listener = () => undefined
  vi.stubGlobal('opencoveApi', {
    meta: { platform: 'darwin' },
    lifecycle: {
      onApplicationShortcut: (handler: typeof listener) => {
        listener = handler
        return () => undefined
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('the shortcut actions', () => {
  const agentSettings = {
    ...DEFAULT_AGENT_SETTINGS,
    disableAppShortcutsWhenTerminalFocused: false,
    keybindings: {},
  }
  function mount({
    spaces = [],
    activeSpaceId = null,
  }: { spaces?: WorkspaceSpaceState[]; activeSpaceId?: string | null } = {}) {
    const canvas = document.createElement('div')
    document.body.append(canvas)
    const calls = {
      closeNode: vi.fn(async () => undefined),
      activateSpace: vi.fn(),
      setActiveSpaceIdFromNodeNavigation: vi.fn(),
      clearNodeSelection: vi.fn(),
    }
    const params = {
      closeNode: calls.closeNode,
      enabled: true,
      workspaceId: 'workspace',
      activeSpaceId,
      spaces,
      agentSettings,
      workspacePath: '/tmp/repo',
      canvasRef: { current: canvas },
      reactFlow: {
        screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        setCenter: vi.fn(),
        setViewport: vi.fn(),
      },
      spaceNavigationAnchorIdRef: { current: null },
      setNodes: vi.fn(),
      updateCanvasDocument: vi.fn(),
      nodeCreation: { createNodeForSession: vi.fn(), createNoteNode: vi.fn() },
      launchAgentAtFlowPosition: vi.fn(),
      createSpaceFromSelectedNodes: vi.fn(),
      activateSpace: calls.activateSpace,
      setActiveSpaceIdFromNodeNavigation: calls.setActiveSpaceIdFromNodeNavigation,
      clearNodeSelection: calls.clearNodeSelection,
      terminalDisplayMetrics: {},
    }
    const view = renderInCanvasDocument(
      () => {
        useWorkspaceCanvasShortcutActions(params as never)
        return useCanvasSelectionCommands()
      },
      { workspaceId: () => shown },
    )
    const press = (code: string, init: KeyboardEventInit = {}) =>
      act(() => {
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: code,
            code,
            metaKey: true,
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        )
      })
    return {
      ...calls,
      view,
      press,
      selection: view.result,
      show: (workspaceId: string) => showWorkspace(view.rerender, workspaceId),
      navigateNodeRight: () => press('ArrowRight', { altKey: true }),
      navigateSpaceRight: () => press('ArrowRight', { altKey: true, shiftKey: true }),
      cycleIdleForward: () => press('BracketRight', { shiftKey: true }),
      closeSelected: () => act(() => listener('close-selected-node')),
    }
  }

  describe('node navigation', () => {
    it('moves to a node that only the store holds, in a Space that only the store holds', () => {
      seedTwoWorkspaces({}, {})
      const { navigateNodeRight, setActiveSpaceIdFromNodeNavigation } = mount()

      act(() => {
        replaceWorkspaceNodes(WORKSPACE_A, [noteAt('node')])
        replaceWorkspaceSpaces(WORKSPACE_A, [createSpace('space', RIGHT_OF_CENTER, ['node'])])
      })
      navigateNodeRight()

      expect(selectNode).toHaveBeenCalledExactlyOnceWith('node')
      expect(setActiveSpaceIdFromNodeNavigation).toHaveBeenCalledExactlyOnceWith('space')
    })

    it('ignores a hidden node', () => {
      seedTwoWorkspaces({}, {})
      const { navigateNodeRight } = mount()

      act(() => {
        replaceWorkspaceNodes(WORKSPACE_A, [
          { ...noteAt('node'), hidden: true },
          noteAt('b-node', 1400, 400),
        ])
      })
      navigateNodeRight()

      expect(selectNode).toHaveBeenCalledExactlyOnceWith('b-node')
    })

    it('reads the nodes of the workspace of the render and not the one shown', () => {
      seedTwoWorkspaces({ nodes: [noteAt('a-node')] }, { nodes: [noteAt('b-node')] })
      const { navigateNodeRight } = mount()

      act(() => useAppStore.setState({ activeWorkspaceId: WORKSPACE_B }))
      navigateNodeRight()

      expect(selectNode).toHaveBeenCalledExactlyOnceWith('a-node')
    })

    it('follows a switch of workspace', () => {
      seedTwoWorkspaces({ nodes: [noteAt('a-node')] }, { nodes: [noteAt('b-node')] })
      const { navigateNodeRight, show } = mount()

      show(WORKSPACE_B)
      navigateNodeRight()

      expect(selectNode).toHaveBeenCalledExactlyOnceWith('b-node')
    })
  })

  describe('Space navigation', () => {
    it('moves to a Space that only the store holds', () => {
      seedTwoWorkspaces({}, {})
      const { navigateSpaceRight, activateSpace, clearNodeSelection } = mount()

      act(() => {
        replaceWorkspaceSpaces(WORKSPACE_A, [createSpace('stored', RIGHT_OF_CENTER)])
      })
      navigateSpaceRight()

      expect(activateSpace).toHaveBeenCalledExactlyOnceWith('stored')
      expect(clearNodeSelection).toHaveBeenCalledTimes(1)
    })

    it('leaves a child Space out of the order', () => {
      seedTwoWorkspaces(
        {
          spaces: [
            {
              ...createSpace('child', { x: 700, y: 0, width: 200, height: 900 }),
              parentSpaceId: 'top',
            },
            createSpace('top', RIGHT_OF_CENTER),
          ],
        },
        {},
      )
      const { navigateSpaceRight, activateSpace } = mount()

      navigateSpaceRight()

      expect(activateSpace).toHaveBeenCalledExactlyOnceWith('top')
    })

    it('reads the Spaces of the workspace of the render and not the one shown', () => {
      seedTwoWorkspaces(
        { spaces: [createSpace('space-a', RIGHT_OF_CENTER)] },
        { spaces: [createSpace('space-b', RIGHT_OF_CENTER)] },
      )
      const { navigateSpaceRight, activateSpace } = mount()

      act(() => useAppStore.setState({ activeWorkspaceId: WORKSPACE_B }))
      navigateSpaceRight()

      expect(activateSpace).toHaveBeenCalledExactlyOnceWith('space-a')
    })

    it('follows a switch of workspace', () => {
      seedTwoWorkspaces(
        { spaces: [createSpace('space-a', RIGHT_OF_CENTER)] },
        { spaces: [createSpace('space-b', RIGHT_OF_CENTER)] },
      )
      const { navigateSpaceRight, activateSpace, show } = mount()

      show(WORKSPACE_B)
      navigateSpaceRight()

      expect(activateSpace).toHaveBeenCalledExactlyOnceWith('space-b')
    })
  })

  describe('cycling the idle Spaces', () => {
    // The Spaces come from the `spaces` prop; whether an agent in them is working comes from the
    // store. With s1 busy the first idle Space is s2, otherwise s1.
    const spaces = [
      createSpace('s1', RIGHT_OF_CENTER, ['agent']),
      createSpace('s2', RIGHT_OF_CENTER),
    ]

    it('sees an agent that started working in the same call', () => {
      seedTwoWorkspaces({ nodes: [agentNode('agent', 'standby')] }, {})
      const { cycleIdleForward, activateSpace } = mount({ spaces })

      act(() => {
        replaceWorkspaceNodes(WORKSPACE_A, [agentNode('agent', 'running')])
      })
      cycleIdleForward()

      expect(activateSpace).toHaveBeenCalledExactlyOnceWith('s2')
    })

    it('reads the agents of the workspace of the render and not the one shown', () => {
      seedTwoWorkspaces(
        { nodes: [agentNode('agent', 'running')] },
        { nodes: [agentNode('agent', 'standby')] },
      )
      const { cycleIdleForward, activateSpace } = mount({ spaces })

      act(() => useAppStore.setState({ activeWorkspaceId: WORKSPACE_B }))
      cycleIdleForward()

      expect(activateSpace).toHaveBeenCalledExactlyOnceWith('s2')
    })

    it('follows a switch of workspace', () => {
      seedTwoWorkspaces(
        { nodes: [agentNode('agent', 'standby')] },
        { nodes: [agentNode('agent', 'running')] },
      )
      const { cycleIdleForward, activateSpace, show } = mount({ spaces })

      show(WORKSPACE_B)
      cycleIdleForward()

      expect(activateSpace).toHaveBeenCalledExactlyOnceWith('s2')
    })
  })

  describe('the close-selected-node shortcut', () => {
    it('reads the nodes of the workspace of the render and not the one shown', () => {
      seedTwoWorkspaces({ nodes: [noteAt('node')] }, {})
      const { closeSelected, selection, closeNode } = mount()
      act(() => selection.current.setNodeIds(['node']))

      act(() => useAppStore.setState({ activeWorkspaceId: WORKSPACE_B }))
      closeSelected()

      expect(closeNode).toHaveBeenCalledExactlyOnceWith('node')
    })

    // The selection is written before the switch and read after it, so this case depends on the
    // selection reader being frozen to the first render. In the app a switch also gives B its own
    // selection; the case pins only that the close reads B's nodes.
    it('finds the node in the workspace shown after a switch', () => {
      seedTwoWorkspaces({}, { nodes: [noteAt('node')] })
      const { closeSelected, selection, closeNode, show } = mount()
      act(() => selection.current.setNodeIds(['node']))

      show(WORKSPACE_B)
      closeSelected()

      expect(closeNode).toHaveBeenCalledExactlyOnceWith('node')
    })

    it('does not close a node that only the workspace left behind holds', () => {
      seedTwoWorkspaces({ nodes: [noteAt('node')] }, {})
      const { closeSelected, selection, closeNode, show } = mount()
      act(() => selection.current.setNodeIds(['node']))

      show(WORKSPACE_B)
      closeSelected()

      expect(closeNode).not.toHaveBeenCalled()
    })
  })
})

describe('the shortcuts hook on its own', () => {
  // Its callbacks are stable here, so only its own reader can make the key handler follow a switch
  // (inside the shortcut actions the navigation callbacks change with the workspace as well).
  const spaces = [createSpace('s1', RIGHT_OF_CENTER, ['agent']), createSpace('s2', RIGHT_OF_CENTER)]
  const callbacks = {
    createSpaceFromSelectedNodes: vi.fn(),
    createNoteAtViewportCenter: vi.fn(),
    createTerminalAtViewportCenter: vi.fn(async () => undefined),
    createAgentAtViewportCenter: vi.fn(async () => undefined),
    activateSpace: vi.fn(),
    navigateNode: vi.fn(),
    navigateSpace: vi.fn(),
  }
  const canvasRef = { current: null }
  const keybindings = {}

  it('cycles the idle Spaces of the workspace shown after a switch', () => {
    seedTwoWorkspaces(
      { nodes: [agentNode('agent', 'standby')] },
      { nodes: [agentNode('agent', 'running')] },
    )
    callbacks.activateSpace.mockClear()
    const view = renderInCanvasDocument(
      () =>
        useWorkspaceCanvasShortcuts({
          enabled: true,
          platform: 'darwin',
          keybindings,
          disableWhenTerminalFocused: false,
          activeSpaceId: null,
          spaces,
          canvasRef,
          ...callbacks,
        }),
      { workspaceId: () => shown },
    )

    showWorkspace(view.rerender, WORKSPACE_B)
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'BracketRight',
          code: 'BracketRight',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    expect(callbacks.activateSpace).toHaveBeenCalledExactlyOnceWith('s2')
  })
})

describe('the creation activation', () => {
  const CANVAS_SCOPE_NODE =
    '<div class="react-flow__node" data-id="node"><textarea data-testid="note-node-textarea"></textarea></div>'

  function mount() {
    vi.useFakeTimers()
    const canvas = document.createElement('div')
    canvas.innerHTML = CANVAS_SCOPE_NODE
    document.body.append(canvas)
    const params = {
      workspaceId: 'workspace',
      canvasRef: { current: canvas },
    }
    const view = renderInCanvasDocument(
      () => useWorkspaceCanvasCreationActivation(params as never),
      { workspaceId: () => shown },
    )
    return {
      textarea: canvas.querySelector('textarea') as HTMLTextAreaElement,
      view,
      request: (nodeId = 'node') => act(() => publishWorkspaceNodeCreated(nodeId)),
      settle: () => act(() => void vi.advanceTimersByTime(100)),
      show: (workspaceId: string) => showWorkspace(view.rerender, workspaceId),
    }
  }

  it('focuses a node that was written to the store in the same call', () => {
    seedTwoWorkspaces({}, {})
    const { textarea, settle } = mount()

    act(() => {
      replaceWorkspaceNodes(WORKSPACE_A, [noteAt('node')])
      publishWorkspaceNodeCreated('node')
    })
    settle()

    expect(document.activeElement).toBe(textarea)
  })

  it('ignores a node that no store holds', () => {
    seedTwoWorkspaces({}, {})
    const { request } = mount()

    request()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for the element of a node of an inactive workspace and gives up after a second', () => {
    // Workspace A is still shown but no longer active when its node is committed and announced,
    // so the canvas view never held the node: the request is accepted from the store, finds no
    // element and is cancelled when the wait is over.
    seedTwoWorkspaces({}, {})
    const { textarea } = mount()
    textarea.parentElement?.remove()

    act(() => {
      useAppStore.setState({ activeWorkspaceId: WORKSPACE_B })
      replaceWorkspaceNodes(WORKSPACE_A, [noteAt('node')])
      publishWorkspaceNodeCreated('node')
    })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    act(() => void vi.advanceTimersByTime(1001))

    expect(vi.getTimerCount()).toBe(0)
  })

  it('reads the nodes of the workspace of the render and not the one shown', () => {
    seedTwoWorkspaces({ nodes: [noteAt('node')] }, {})
    const { textarea, request, settle } = mount()

    act(() => useAppStore.setState({ activeWorkspaceId: WORKSPACE_B }))
    request()
    settle()

    expect(document.activeElement).toBe(textarea)
  })

  it('finds a node of the workspace shown after a switch', () => {
    seedTwoWorkspaces({}, { nodes: [noteAt('node')] })
    const { textarea, request, settle, show } = mount()

    show(WORKSPACE_B)
    request()
    settle()

    expect(document.activeElement).toBe(textarea)
  })

  it('does not find a node of the workspace left behind after a switch', () => {
    seedTwoWorkspaces({ nodes: [noteAt('node')] }, {})
    const { request, show } = mount()

    show(WORKSPACE_B)
    request()

    expect(vi.getTimerCount()).toBe(0)
  })
})
