import { act, renderHook } from '@testing-library/react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasLifecycle } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useLifecycle'
import { useWorkspaceCanvasNoteToTaskConversion } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNoteToTaskConversion'
import { useWorkspaceCanvasShortcutActions } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasShortcutActions'
import { useWorkspaceCanvasCreateSpace } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaces.createSpace'
import { createCanvasInputModalityState } from '@contexts/workspace/presentation/renderer/utils/inputModality'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import {
  useCanvasSelectionCommands,
  useReadCanvasSelection,
} from '@contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { CANVAS_STORE_TEST_WORKSPACE_ID } from '../../support/canvasStoreTestHarness'
import {
  SelectionWritersWrapper,
  createNodeHolder,
  createRowNodes,
  createSpace,
} from '../../support/canvasSelectionFixtures'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Every handler that used to read `selectedNodeIdsRef` reads the canvas store's `selection` slice
// when it runs, and the hook that owned the ref's mirror is gone (#692, PR 2).

function useSelectionProbe() {
  return {
    selection: useCanvasSelectionCommands(),
    readSelection: useReadCanvasSelection(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Delete key in useWorkspaceCanvasLifecycle', () => {
  function setup(nodeIds: string[]) {
    const requestNodeDelete = vi.fn()
    const reactFlow = {
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>
    const hook = renderHook(
      () => {
        useWorkspaceCanvasLifecycle({
          workspaceId: 'readers',
          selectionDraftRef: { current: null },
          trackpadGestureLockRef: { current: null },
          setIsCanvasWheelGestureCaptureActive: vi.fn(),
          reactFlow,
          viewport: { x: 0, y: 0, zoom: 1 },
          viewportRef: { current: { x: 0, y: 0, zoom: 1 } },
          canvasInputModeSetting: 'mouse',
          inputModalityStateRef: { current: createCanvasInputModalityState('mouse') },
          setDetectedCanvasInputMode: vi.fn(),
          isShiftPressedRef: { current: false },
          setIsShiftPressed: vi.fn(),
          requestNodeDeleteRef: { current: requestNodeDelete },
          focusNodeTargetZoom: 1,
          isFocusNodeTargetZoomPreviewing: false,
        })
        return useSelectionProbe()
      },
      { wrapper: SelectionWritersWrapper },
    )
    act(() => hook.result.current.selection.setNodeIds(nodeIds))
    return { requestNodeDelete, ...hook }
  }

  const press = () =>
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
      )
    })

  it('asks to delete the windows the store names', () => {
    const { requestNodeDelete } = setup(['a', 'b'])

    press()

    expect(requestNodeDelete).toHaveBeenCalledExactlyOnceWith(['a', 'b'])
  })

  it('asks for nothing when the store names no window', () => {
    const { requestNodeDelete } = setup([])

    press()

    expect(requestNodeDelete).not.toHaveBeenCalled()
  })
})

describe('convertSelectedNoteToTask in useWorkspaceCanvasNoteToTaskConversion', () => {
  function setup(nodeIds: string[]) {
    const holder = createNodeHolder(createRowNodes(['a', 'b']))
    const onRequestPersistFlush = vi.fn()
    const hook = renderHook(
      () => ({
        conversion: useWorkspaceCanvasNoteToTaskConversion({
          // Differs from the store on purpose: the conversion must read the store at call time.
          selectedNodeIds: [],
          flowNodes: holder.nodes,
          nodesRef: holder.nodesRef,
          spacesRef: { current: [] },
          setNodes: holder.setNodes,
          onSpacesChange: vi.fn(),
          onRequestPersistFlush,
          standardWindowSizeBucket: 'regular',
        }),
        ...useSelectionProbe(),
      }),
      { wrapper: SelectionWritersWrapper },
    )
    act(() => hook.result.current.selection.setNodeIds(nodeIds))
    return { holder, onRequestPersistFlush, ...hook }
  }

  it('converts the one note the store names', () => {
    const { result, holder, onRequestPersistFlush } = setup(['b'])

    act(() => result.current.conversion.convertSelectedNoteToTask())

    expect(holder.nodes.map(node => node.data.kind)).toEqual(['note', 'task'])
    expect(onRequestPersistFlush).toHaveBeenCalledTimes(1)
  })

  it('converts nothing when the store names two windows', () => {
    const { result, holder } = setup(['a', 'b'])

    act(() => result.current.conversion.convertSelectedNoteToTask())

    expect(holder.nodes.map(node => node.data.kind)).toEqual(['note', 'note'])
  })

  it('converts nothing when the store names none, even if a document node is flagged', () => {
    const { result, holder } = setup([])
    act(() => holder.setNodes(nodes => nodes.map(node => ({ ...node, selected: true }))))

    act(() => result.current.conversion.convertSelectedNoteToTask())

    expect(holder.nodes.map(node => node.data.kind)).toEqual(['note', 'note'])
  })
})

describe('createSpaceFromSelectedNodes in useWorkspaceCanvasCreateSpace', () => {
  function setup(options: { nodeIds: string[]; flowFlagged?: string[] }) {
    const nodes = createRowNodes(['a', 'b'])
    const spaces = [
      createSpace('parent', { x: -100, y: -100, width: 1200, height: 600 }, ['a']),
      createSpace('child', { x: -20, y: -20, width: 400, height: 300 }, ['a']),
    ]
    spaces[1] = { ...spaces[1], parentSpaceId: 'parent' }
    // The hook reads the committed document of workspace `readers`.
    createCanvasDocumentHarness({ workspaceId: 'readers', nodes, spaces })
    const createChildSpaceInParent = vi.fn(() => null)
    const reactFlow = {
      getNodes: () =>
        nodes.map(node => ({
          ...node,
          selected: (options.flowFlagged ?? []).includes(node.id),
        })),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    vi.stubGlobal('opencoveApi', {
      controlSurface: { invoke: vi.fn(async () => ({ mounts: [] })) },
    })
    const hook = renderInCanvasDocument(
      () => ({
        create: useWorkspaceCanvasCreateSpace({
          workspaceId: 'readers',
          workspacePath: '/tmp/repo',
          standardWindowSizeBucket: 'regular',
          reactFlow,
          updateCanvasDocument: vi.fn(),
          createChildSpaceInParent,
        }),
        ...useSelectionProbe(),
      }),
      { workspaceId: 'readers' },
    )
    act(() => hook.result.current.selection.setNodeIds(options.nodeIds))
    return { createChildSpaceInParent, ...hook }
  }

  it('uses the windows the store names to find the parent Space', () => {
    const { result, createChildSpaceInParent } = setup({ nodeIds: ['a'] })

    act(() => result.current.create.createSpaceFromSelectedNodes())

    expect(createChildSpaceInParent).toHaveBeenCalledExactlyOnceWith('child', { nodeIds: ['a'] })
  })

  it('prefers the store over the flags React Flow reports', () => {
    const { result, createChildSpaceInParent } = setup({ nodeIds: ['a'], flowFlagged: ['b'] })

    act(() => result.current.create.createSpaceFromSelectedNodes())

    expect(createChildSpaceInParent).toHaveBeenCalledExactlyOnceWith('child', { nodeIds: ['a'] })
  })

  it('falls back to the flags React Flow reports when the store names none', () => {
    const { result, createChildSpaceInParent } = setup({ nodeIds: [], flowFlagged: ['a'] })

    act(() => result.current.create.createSpaceFromSelectedNodes())

    expect(createChildSpaceInParent).toHaveBeenCalledExactlyOnceWith('child', { nodeIds: ['a'] })
  })
})

describe('spatial navigation in useWorkspaceCanvasShortcutActions', () => {
  function setup(options: { nodeIds: string[]; withSpaces?: boolean }) {
    vi.stubGlobal('opencoveApi', { meta: { platform: 'darwin' } })
    const holder = createNodeHolder(createRowNodes(['a', 'b', 'c']))
    const canvas = document.createElement('div')
    document.body.append(canvas)
    const spaces = options.withSpaces
      ? [
          createSpace('s1', { x: -50, y: -50, width: 450, height: 300 }, ['a']),
          createSpace('s2', { x: 350, y: -50, width: 450, height: 300 }, ['b']),
          createSpace('s3', { x: 750, y: -50, width: 450, height: 300 }, ['c']),
        ]
      : []
    // The shortcuts read the committed document of the workspace of the provider.
    createCanvasDocumentHarness({
      workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
      nodes: holder.nodes,
      spaces,
    })
    const activateSpace = vi.fn()
    const clearNodeSelection = vi.fn()
    const reactFlow = {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setCenter: vi.fn(),
      setViewport: vi.fn(),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>
    const hook = renderHook(
      () => {
        useWorkspaceCanvasShortcutActions({
          closeNode: vi.fn(async () => undefined),
          enabled: true,
          workspaceId: 'readers',
          activeSpaceId: null,
          spaces,
          agentSettings: {
            ...DEFAULT_AGENT_SETTINGS,
            disableAppShortcutsWhenTerminalFocused: false,
            keybindings: {},
          },
          workspacePath: '/tmp/repo',
          canvasRef: { current: canvas },
          reactFlow,
          spaceNavigationAnchorIdRef: { current: null },
          setNodes: holder.setNodes,
          updateCanvasDocument: vi.fn(),
          nodeCreation: {
            createNodeForSession: vi.fn(async () => null),
            createNoteNode: vi.fn(() => null),
          },
          launchAgentAtFlowPosition: vi.fn(async () => undefined),
          createSpaceFromSelectedNodes: vi.fn(),
          activateSpace,
          setActiveSpaceIdFromNodeNavigation: vi.fn(),
          clearNodeSelection,
          terminalDisplayMetrics: {} as never,
        })
        return useSelectionProbe()
      },
      { wrapper: SelectionWritersWrapper },
    )
    act(() => hook.result.current.selection.setNodeIds(options.nodeIds))
    const press = (code: string, shiftKey = false) =>
      act(() => {
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: code,
            code,
            metaKey: true,
            altKey: true,
            shiftKey,
            bubbles: true,
            cancelable: true,
          }),
        )
      })
    return { holder, activateSpace, clearNodeSelection, press, ...hook }
  }

  it('moves the selection from the window the store names to its neighbour', () => {
    const { result, press } = setup({ nodeIds: ['b'] })

    press('ArrowLeft')

    expect(result.current.readSelection().nodeIds).toEqual(['a'])
  })

  it('moves from the first of several windows the store names', () => {
    const { result, press } = setup({ nodeIds: ['c', 'a'] })

    press('ArrowLeft')

    expect(result.current.readSelection().nodeIds).toEqual(['b'])
  })

  it('activates the Space next to the Space of the window the store names', () => {
    const { activateSpace, clearNodeSelection, press } = setup({ nodeIds: ['a'], withSpaces: true })

    press('ArrowRight', true)

    expect(activateSpace).toHaveBeenCalledExactlyOnceWith('s2')
    expect(clearNodeSelection).toHaveBeenCalledTimes(1)
  })
})
