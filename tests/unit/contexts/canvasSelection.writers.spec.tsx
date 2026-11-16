import { act, renderHook } from '@testing-library/react'
import {
  useReactFlow,
  useStoreApi,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasInteractions } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions'
import { useWorkspaceCanvasSelectionDraft } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectionDraft'
import { useWorkspaceCanvasSelectNode } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectNode'
import { useWorkspaceCanvasSpaceDrag } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag'
import type { SelectionDraftState } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import {
  useCanvasSelectionCommands,
  useReadCanvasSelection,
  useReadCanvasUi,
} from '@contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import {
  SelectionWritersWrapper,
  createNodeHolder,
  createRowNodes,
  createSpace,
} from '../../support/canvasSelectionFixtures'

// Each writer of the node selection writes the canvas store's `selection` slice with one command,
// and keeps writing the `selected` flag on the document nodes and the two React Flow store flags
// in the same call (Decision 3 of #692: the flag stays a mirror until S6).

function useStoreProbe() {
  const reactFlowStore = useStoreApi()
  return {
    selection: useCanvasSelectionCommands(),
    readSelection: useReadCanvasSelection(),
    readUi: useReadCanvasUi(),
    readFlowFlags: () => {
      const state = reactFlowStore.getState() as unknown as {
        nodesSelectionActive: boolean
        coveDragSurfaceSelectionMode: boolean
      }
      return {
        nodesSelectionActive: state.nodesSelectionActive,
        coveDragSurfaceSelectionMode: state.coveDragSurfaceSelectionMode,
      }
    },
  }
}

function spyOnCommands(selection: ReturnType<typeof useCanvasSelectionCommands>) {
  return {
    select: vi.spyOn(selection, 'select'),
    others: [
      vi.spyOn(selection, 'setNodeIds'),
      vi.spyOn(selection, 'setSpaceIds'),
      vi.spyOn(selection, 'clear'),
    ],
  }
}

function expectOnlySelect(spies: ReturnType<typeof spyOnCommands>, times = 1): void {
  expect(spies.select).toHaveBeenCalledTimes(times)
  spies.others.forEach(spy => expect(spy).not.toHaveBeenCalled())
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('selectNode', () => {
  function setup(options: { flagged?: string[]; nodeIds?: string[]; spaceIds?: string[] }) {
    const holder = createNodeHolder(createRowNodes(['a', 'b', 'c'], options.flagged ?? []))
    const spacesRef = { current: [] }
    const hook = renderHook(
      () => ({
        select: useWorkspaceCanvasSelectNode({ setNodes: holder.setNodes, spacesRef }),
        ...useStoreProbe(),
      }),
      { wrapper: SelectionWritersWrapper },
    )
    act(() =>
      hook.result.current.selection.select({
        nodeIds: options.nodeIds ?? [],
        spaceIds: options.spaceIds ?? [],
      }),
    )
    return { holder, ...hook }
  }

  it('selects only the clicked window, clears the Spaces and mirrors the flag', () => {
    const { result, holder } = setup({ flagged: ['b'], nodeIds: ['b'], spaceIds: ['s'] })
    const spies = spyOnCommands(result.current.selection)

    act(() => result.current.select('a'))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['a'], spaceIds: [] })
    expect(holder.selectedIds).toEqual(['a'])
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: true,
      coveDragSurfaceSelectionMode: false,
    })
    expectOnlySelect(spies)
  })

  it('keeps the selected Spaces when the only selected window is clicked again', () => {
    const { result } = setup({ flagged: ['a'], nodeIds: ['a'], spaceIds: ['s'] })

    act(() => result.current.select('a'))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['a'], spaceIds: ['s'] })
  })

  it('decides "already selected" from the store, not from the flag on the document node', () => {
    // The document flag is set, the store does not name the window: the Spaces go.
    const { result } = setup({ flagged: ['a'], nodeIds: [], spaceIds: ['s'] })

    act(() => result.current.select('a'))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['a'], spaceIds: [] })
  })

  it('toggles within the scope, keeps the Spaces and turns the drag surface mode on', () => {
    const { result, holder } = setup({ flagged: ['a', 'b'], nodeIds: ['a', 'b'], spaceIds: ['s'] })
    const spies = spyOnCommands(result.current.selection)

    act(() => result.current.select('c', { toggle: true }))

    expect(result.current.readSelection()).toMatchObject({
      nodeIds: ['a', 'b', 'c'],
      spaceIds: ['s'],
    })
    expect(holder.selectedIds).toEqual(['a', 'b', 'c'])
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: true,
      coveDragSurfaceSelectionMode: true,
    })

    act(() => result.current.select('a', { toggle: true }))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['b', 'c'], spaceIds: ['s'] })
    expect(holder.selectedIds).toEqual(['b', 'c'])
    expectOnlySelect(spies, 2)
  })

  it('turns the drag surface mode off when a toggle empties the whole selection', () => {
    const { result } = setup({ flagged: ['a'], nodeIds: ['a'] })

    act(() => result.current.select('a', { toggle: true }))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: [] })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    })
  })

  it('keeps the drag surface mode on when a toggle empties the windows but a Space stays', () => {
    const { result } = setup({ flagged: ['a'], nodeIds: ['a'], spaceIds: ['s'] })

    act(() => result.current.select('a', { toggle: true }))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: ['s'] })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: true,
    })
  })
})

describe('node selection writers in useWorkspaceCanvasInteractions', () => {
  function setup(options: { flagged?: string[]; nodeIds?: string[]; spaceIds?: string[] }) {
    const holder = createNodeHolder(createRowNodes(['a', 'b', 'c'], options.flagged ?? []))
    const canvas = document.createElement('div')
    const spacesRef = { current: [] }
    const reactFlow = {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getNodes: () => holder.nodes,
      getNode: (id: string) => holder.nodes.find(node => node.id === id),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>
    const hook = renderHook(
      () => ({
        interactions: useWorkspaceCanvasInteractions({
          canvasRef: { current: canvas },
          isTrackpadCanvasMode: false,
          focusNodeOnClick: false,
          focusNodeTargetZoom: 1,
          websiteWindowsEnabled: false,
          websiteWindowPasteEnabled: false,
          isShiftPressedRef: { current: false },
          selectionDraftRef: { current: null },
          setSelectionDraftUi: vi.fn(),
          reactFlow,
          setNodes: holder.setNodes,
          workspaceId: 'writers',
          workspacePath: '/tmp/repo',
          defaultTerminalProfileId: null,
          terminalFontSize: 13,
          terminalDisplayMetrics: {} as never,
          spacesRef,
          updateCanvasDocument: vi.fn(),
          nodesRef: holder.nodesRef,
          standardWindowSizeBucket: 'regular',
          browserDefaultMode: 'headless' as never,
          createNodeForSession: vi.fn(async () => null),
          createNoteNode: vi.fn(() => null),
          createImageNode: vi.fn(() => null),
          createWebsiteNode: vi.fn(() => null),
        }),
        ...useStoreProbe(),
      }),
      { wrapper: SelectionWritersWrapper },
    )
    act(() =>
      hook.result.current.selection.select({
        nodeIds: options.nodeIds ?? [],
        spaceIds: options.spaceIds ?? [],
      }),
    )
    return { holder, ...hook }
  }

  it('clears the nodes, the Spaces, the flags and both React Flow flags on a pane click', () => {
    const { result, holder } = setup({ flagged: ['a', 'b'], nodeIds: ['a', 'b'], spaceIds: ['s'] })
    const spies = { select: vi.spyOn(result.current.selection, 'clear') }
    const others = [
      vi.spyOn(result.current.selection, 'select'),
      vi.spyOn(result.current.selection, 'setNodeIds'),
      vi.spyOn(result.current.selection, 'setSpaceIds'),
    ]

    act(() => result.current.interactions.handlePaneClick({ button: 0 } as React.MouseEvent))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: [] })
    expect(holder.selectedIds).toEqual([])
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    })
    expect(spies.select).toHaveBeenCalledTimes(1)
    others.forEach(spy => expect(spy).not.toHaveBeenCalled())
  })

  it('clears a selection that holds only Spaces', () => {
    const { result } = setup({ spaceIds: ['s'] })

    act(() => result.current.interactions.clearNodeSelection())

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: [] })
  })

  it('opens the selection menu for a window the store names, whatever its flag says', () => {
    const { result } = setup({ nodeIds: ['b'] })
    const preventDefault = vi.fn()
    const node = holderNode('b')

    act(() =>
      result.current.interactions.handleNodeContextMenu(
        { preventDefault, clientX: 5, clientY: 6 } as unknown as React.MouseEvent,
        node,
      ),
    )

    expect(preventDefault).toHaveBeenCalled()
    expect(result.current.readUi().contextMenu).toMatchObject({ kind: 'selection', nodeId: 'b' })
  })

  it('does nothing for a window the store does not name, even when its flag is set', () => {
    const { result } = setup({ flagged: ['b'], nodeIds: [] })
    const preventDefault = vi.fn()

    act(() =>
      result.current.interactions.handleNodeContextMenu(
        { preventDefault, clientX: 5, clientY: 6 } as unknown as React.MouseEvent,
        { ...holderNode('b'), selected: true },
      ),
    )

    expect(preventDefault).not.toHaveBeenCalled()
    expect(result.current.readUi().contextMenu).toBeNull()
  })
})

function holderNode(id: string): Node<TerminalNodeData> {
  return createRowNodes(['a', 'b', 'c']).find(node => node.id === id)!
}

describe('marquee in useWorkspaceCanvasSelectionDraft', () => {
  function setup(options: {
    flagged?: string[]
    nodeIds?: string[]
    spaceIds?: string[]
    spaces?: ReturnType<typeof createSpace>[]
  }) {
    const holder = createNodeHolder(createRowNodes(['a', 'b', 'c'], options.flagged ?? []))
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    document.body.append(pane)
    const selectionDraftRef: { current: SelectionDraftState | null } = { current: null }
    const spacesRef = { current: options.spaces ?? [] }
    const reactFlow = {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getNodes: () => holder.nodes,
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    const hook = renderHook(
      () => ({
        draft: useWorkspaceCanvasSelectionDraft({
          workspaceId: 'writers',
          isTrackpadCanvasMode: true,
          isShiftPressedRef: { current: false },
          selectionDraftRef,
          setSelectionDraftUi: vi.fn(),
          reactFlow,
          spacesRef,
          setNodes: holder.setNodes,
        }),
        ...useStoreProbe(),
      }),
      { wrapper: SelectionWritersWrapper },
    )
    act(() =>
      hook.result.current.selection.select({
        nodeIds: options.nodeIds ?? [],
        spaceIds: options.spaceIds ?? [],
      }),
    )
    const pointerDown = (x: number, y: number) =>
      act(() =>
        hook.result.current.draft.handleCanvasPointerDownCapture({
          button: 0,
          shiftKey: false,
          target: pane,
          clientX: x,
          clientY: y,
          pointerId: 1,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as React.PointerEvent<HTMLDivElement>),
      )
    const pointerUp = (x: number, y: number) => {
      let committed = false
      act(() => {
        committed = hook.result.current.draft.handleCanvasPointerUpCapture({
          clientX: x,
          clientY: y,
        })
      })
      return committed
    }
    return { holder, pane, selectionDraftRef, pointerDown, pointerUp, ...hook }
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('writes the marquee result with one select, and mirrors the flag and the flow flags', () => {
    const { result, holder, pointerDown, pointerUp } = setup({
      flagged: ['b'],
      nodeIds: ['b'],
    })
    const spies = spyOnCommands(result.current.selection)

    pointerDown(-50, -50)
    expect(pointerUp(350, 250)).toBe(true)

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['a'], spaceIds: [] })
    expect(holder.selectedIds).toEqual(['a'])
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: true,
      coveDragSurfaceSelectionMode: true,
    })
    expectOnlySelect(spies)
  })

  it('selects a touched Space and no window inside it with the same single command', () => {
    const { result, holder, pointerDown, pointerUp } = setup({
      spaces: [createSpace('s', { x: 0, y: 0, width: 360, height: 260 }, ['a'])],
    })
    const spies = spyOnCommands(result.current.selection)

    pointerDown(-50, -50)
    pointerUp(350, 250)

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: ['s'] })
    expect(holder.selectedIds).toEqual([])
    // Nodes: none selected. A selected Space alone still turns the drag surface mode on.
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: true,
    })
    expectOnlySelect(spies)
  })

  it('turns both flow flags off when the marquee selects nothing', () => {
    const { result, pointerDown, pointerUp } = setup({ flagged: ['b'], nodeIds: ['b'] })

    pointerDown(1000, 600)
    pointerUp(1100, 700)

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: [] })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    })
  })

  it('captures the selected Spaces from the store when the marquee starts', () => {
    const { result, selectionDraftRef, pointerDown } = setup({ spaceIds: ['s'] })

    pointerDown(1000, 600)

    expect(selectionDraftRef.current?.selectedSpaceIdsAtStart).toEqual(['s'])
    expect(result.current.readSelection().spaceIds).toEqual(['s'])
  })

  it('clears nodes and Spaces with one clear when a click without drag ends a marquee', () => {
    const { result, holder, pointerDown, pointerUp } = setup({
      flagged: ['a'],
      nodeIds: ['a'],
      spaceIds: ['s'],
    })
    const clear = vi.spyOn(result.current.selection, 'clear')
    const others = [
      vi.spyOn(result.current.selection, 'select'),
      vi.spyOn(result.current.selection, 'setNodeIds'),
      vi.spyOn(result.current.selection, 'setSpaceIds'),
    ]

    pointerDown(1000, 600)
    expect(pointerUp(1002, 601)).toBe(false)

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: [] })
    expect(holder.selectedIds).toEqual([])
    expect(clear).toHaveBeenCalledTimes(1)
    others.forEach(spy => expect(spy).not.toHaveBeenCalled())
  })

  it('clears a Space-only selection when a click without drag ends a marquee', () => {
    const { result, pointerDown, pointerUp } = setup({ spaceIds: ['s'] })

    pointerDown(1000, 600)
    pointerUp(1002, 601)

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: [] })
  })
})

describe('Space click selection in useWorkspaceCanvasSpaceDrag', () => {
  function setup(options: { flagged?: string[]; nodeIds?: string[]; spaceIds?: string[] }) {
    const harness = createCanvasDocumentHarness({
      nodes: createRowNodes(['a', 'b', 'c', 'd'], options.flagged ?? []),
      spaces: [
        createSpace('s', { x: -50, y: -50, width: 400, height: 400 }, ['a']),
        createSpace('t', { x: 1500, y: 0, width: 400, height: 400 }, []),
      ],
    })
    // The nodes as the store holds them, with the helpers the cases below read.
    const holder = {
      get nodes() {
        return harness.readStoreDocument().nodes
      },
      get selectedIds() {
        return harness
          .readStoreDocument()
          .nodes.filter(node => node.selected)
          .map(node => node.id)
      },
    }
    // Stable: the hook clears a drag in progress whenever this callback changes.
    const setSnapGuides = vi.fn()
    function useDragUnderTest({ workspaceId, nodeStore }: CanvasNodeStoreContext) {
      const flow = useReactFlow<Node<TerminalNodeData>>()
      return {
        drag: useWorkspaceCanvasSpaceDrag({
          workspaceId,
          reactFlow: { ...flow, screenToFlowPosition: point => point, getZoom: () => 1 },
          setNodes: nodeStore.setNodes,
          updateCanvasDocument: nodeStore.updateCanvasDocument,
          magneticSnappingEnabledRef: { current: false },
          setSnapGuides,
        }),
        ...useStoreProbe(),
      }
    }
    const hook = renderCanvasNodeStore(harness, { extend: useDragUnderTest })
    act(() =>
      hook.result.current.selection.select({
        nodeIds: options.nodeIds ?? [],
        spaceIds: options.spaceIds ?? [],
      }),
    )
    const down = (spaceId: string, point: { x: number; y: number }, shiftKey = false) =>
      act(() =>
        hook.result.current.drag.handleSpaceDragHandlePointerDown(
          {
            button: 0,
            shiftKey,
            clientX: point.x,
            clientY: point.y,
            pointerId: 1,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          } as unknown as React.PointerEvent<HTMLDivElement>,
          spaceId,
        ),
      )
    const up = (point: { x: number; y: number }) =>
      act(() => {
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: point.x, clientY: point.y }))
      })
    return { holder, down, up, ...hook }
  }

  it('selects the clicked Space with one select, clears the windows, flags and flow flags', () => {
    const { result, holder, down } = setup({ flagged: ['a', 'b'], nodeIds: ['a', 'b'] })
    const spies = spyOnCommands(result.current.selection)

    down('s', { x: 100, y: -40 })

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: ['s'] })
    expect(holder.selectedIds).toEqual([])
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    })
    expectOnlySelect(spies)
  })

  it('does not select again when the Space is already selected', () => {
    const { result, down } = setup({ nodeIds: ['b'], spaceIds: ['s'] })

    down('s', { x: 100, y: -40 })

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['b'], spaceIds: ['s'] })
  })

  it('toggles a Space on with Shift on pointer up, keeping the selected windows', () => {
    const { result, down, up } = setup({ flagged: ['b'], nodeIds: ['b'], spaceIds: ['t'] })

    down('s', { x: 100, y: -40 }, true)
    expect(result.current.readSelection().spaceIds).toEqual(['t'])
    up({ x: 100, y: -40 })

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['b'], spaceIds: ['s', 't'] })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: true,
      coveDragSurfaceSelectionMode: true,
    })
  })

  it('toggles a selected Space off with Shift and leaves the drag surface mode by what remains', () => {
    const { result, down, up } = setup({ spaceIds: ['s'] })

    down('s', { x: 100, y: -40 }, true)
    up({ x: 100, y: -40 })

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: [] })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    })
  })

  it('moves the windows selected in the store together with the Space it drags', () => {
    // `c` is outside Space `s` and selected; dragging `s` must carry it. `d` is not selected.
    const { holder, down, up } = setup({ flagged: ['c'], nodeIds: ['c'], spaceIds: ['s'] })
    const before = Object.fromEntries(holder.nodes.map(node => [node.id, node.position.x]))

    down('s', { x: 100, y: -40 })
    up({ x: 120, y: -40 })

    const moved = (id: string) => holder.nodes.find(node => node.id === id)!.position.x - before[id]
    expect(moved('a')).toBe(20)
    expect(moved('c')).toBe(20)
    expect(moved('b')).toBe(0)
    expect(moved('d')).toBe(0)
  })
})
