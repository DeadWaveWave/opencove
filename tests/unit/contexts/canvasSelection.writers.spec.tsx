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
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  renderInCanvasDocument,
  type CanvasDocumentHarness,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import { CANVAS_STORE_TEST_WORKSPACE_ID } from '../../support/canvasStoreTestHarness'
import {
  SelectionWritersWrapper,
  createRowNodes,
  createSpace,
} from '../../support/canvasSelectionFixtures'
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'
import { readWorkspaceDocument } from '@contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { setDocumentNodes } from '../../support/documentNodes'

// Each writer of the node selection writes the canvas store's `selection` slice with one command
// and the two React Flow store flags in the same call, and writes nothing else: not the document
// (no `selected` mirror, no app store notification, no flush), S7 PR 2. Which windows a writer
// selects is computed from the slice, the document's nodes (for the order and the positions) and
// the document's Spaces (for the scope) when it runs; the flag of a document node is never read.

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

/**
 * The row of notes as the document holds them: sized, as the node store's first write leaves them,
 * so that a write through the writer is never only the initial-size fix.
 */
function documentRow(
  ids: readonly string[],
  selectedIds: readonly string[] = [],
): Node<TerminalNodeData>[] {
  return createRowNodes(ids, selectedIds).map(node => ({
    ...node,
    initialWidth: node.data.width,
    initialHeight: node.data.height,
  }))
}

/** The document is the one the writer found: no notification, no flush, the same nodes array. */
function expectNoDocumentWrite(
  harness: CanvasDocumentHarness,
  nodesBefore: Node<TerminalNodeData>[],
): void {
  expect(harness.notifications).not.toHaveBeenCalled()
  expect(harness.flush).not.toHaveBeenCalled()
  expect(harness.readStoreDocument().nodes).toBe(nodesBefore)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('selectNode', () => {
  function setup(options: {
    flagged?: string[]
    nodeIds?: string[]
    spaceIds?: string[]
    spaces?: ReturnType<typeof createSpace>[]
  }) {
    const harness = createCanvasDocumentHarness({
      nodes: documentRow(['a', 'b', 'c'], options.flagged ?? []),
      spaces: options.spaces ?? [],
    })
    const hook = renderInCanvasDocument(() => ({
      select: useWorkspaceCanvasSelectNode(),
      ...useStoreProbe(),
    }))
    act(() =>
      hook.result.current.selection.select({
        nodeIds: options.nodeIds ?? [],
        spaceIds: options.spaceIds ?? [],
      }),
    )
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()
    return { harness, nodesBefore, ...hook }
  }

  it('selects only the clicked window and clears the Spaces: one select, the flow flags, no document write', () => {
    const { result, harness, nodesBefore } = setup({
      flagged: ['b'],
      nodeIds: ['b'],
      spaceIds: ['s'],
    })
    const spies = spyOnCommands(result.current.selection)

    act(() => result.current.select('a'))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['a'], spaceIds: [] })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: true,
      coveDragSurfaceSelectionMode: false,
    })
    expectOnlySelect(spies)
    expectNoDocumentWrite(harness, nodesBefore)
  })

  it('keeps the selected Spaces when the only selected window is clicked again', () => {
    const { result, harness, nodesBefore } = setup({
      flagged: ['a'],
      nodeIds: ['a'],
      spaceIds: ['s'],
    })

    act(() => result.current.select('a'))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['a'], spaceIds: ['s'] })
    expectNoDocumentWrite(harness, nodesBefore)
  })

  it('keeps a multi-selection when a selected window is clicked, in document order', () => {
    const { result, harness, nodesBefore } = setup({ nodeIds: ['c', 'a'] })

    act(() => result.current.select('c'))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['a', 'c'], spaceIds: [] })
    expect(result.current.readFlowFlags()).toMatchObject({ nodesSelectionActive: true })
    expectNoDocumentWrite(harness, nodesBefore)
  })

  it('decides "already selected" from the store, not from the flag on the document node', () => {
    // The document flag is set, the store does not name the window: the Spaces go.
    const { result } = setup({ flagged: ['a'], nodeIds: [], spaceIds: ['s'] })

    act(() => result.current.select('a'))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['a'], spaceIds: [] })
  })

  it('writes nothing for a window the document no longer holds', () => {
    // Invariant 2 of #761: a command whose target the document no longer holds writes nothing
    // about it. `gone` is a dangling id (a late callback of a closed window): selecting it would
    // leave it in the slice and clear the selection of the windows that are there.
    const { result } = setup({ nodeIds: ['a', 'gone'] })
    const flagsBefore = result.current.readFlowFlags()
    const spies = spyOnCommands(result.current.selection)

    act(() => result.current.select('gone'))
    act(() => result.current.select('gone', { toggle: true }))

    expect(result.current.readSelection().nodeIds).toEqual(['a', 'gone'])
    expect(result.current.readFlowFlags()).toEqual(flagsBefore)
    expect(spies.select).not.toHaveBeenCalled()
  })

  it('toggles within the scope, keeps the Spaces and turns the drag surface mode on', () => {
    const { result, harness, nodesBefore } = setup({
      flagged: ['a', 'b'],
      nodeIds: ['a', 'b'],
      spaceIds: ['s'],
    })
    const spies = spyOnCommands(result.current.selection)

    act(() => result.current.select('c', { toggle: true }))

    expect(result.current.readSelection()).toMatchObject({
      nodeIds: ['a', 'b', 'c'],
      spaceIds: ['s'],
    })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: true,
      coveDragSurfaceSelectionMode: true,
    })

    act(() => result.current.select('a', { toggle: true }))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['b', 'c'], spaceIds: ['s'] })
    expectOnlySelect(spies, 2)
    expectNoDocumentWrite(harness, nodesBefore)
  })

  it('drops the windows of other scopes from a toggle, by the Spaces of the document', () => {
    // Space `s` holds a and b; c is outside every Space. Toggling c leaves a and b out of c's scope.
    const { result, harness, nodesBefore } = setup({
      nodeIds: ['a', 'b'],
      spaces: [createSpace('s', { x: -50, y: -50, width: 700, height: 400 }, ['a', 'b'])],
    })

    act(() => result.current.select('c', { toggle: true }))
    expect(result.current.readSelection().nodeIds).toEqual(['c'])

    // And inside the Space, c is out of scope.
    act(() => result.current.select('a', { toggle: true }))
    expect(result.current.readSelection().nodeIds).toEqual(['a'])
    expectNoDocumentWrite(harness, nodesBefore)
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
    const harness = createCanvasDocumentHarness({
      nodes: documentRow(['a', 'b', 'c'], options.flagged ?? []),
    })
    const canvas = document.createElement('div')
    const reactFlow = {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getNodes: () => harness.readStoreDocument().nodes,
      getNode: (id: string) => harness.readStoreDocument().nodes.find(node => node.id === id),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>
    const hook = renderInCanvasDocument(() => ({
      interactions: useWorkspaceCanvasInteractions({
        canvasRef: { current: canvas },
        isTrackpadCanvasMode: false,
        focusNodeOnClick: false,
        focusNodeTargetZoom: 1,
        websiteWindowsEnabled: false,
        websiteWindowPasteEnabled: false,
        isShiftPressedRef: { current: false },
        selectionDraftRef: { current: null },
        reactFlow,
        workspaceId: 'writers',
        workspacePath: '/tmp/repo',
        defaultTerminalProfileId: null,
        terminalFontSize: 13,
        terminalDisplayMetrics: {} as never,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'headless' as never,
        createNodeForSession: vi.fn(async () => null),
        createNoteNode: vi.fn(() => null),
        createImageNode: vi.fn(() => null),
        createWebsiteNode: vi.fn(() => null),
      }),
      ...useStoreProbe(),
    }))
    act(() =>
      hook.result.current.selection.select({
        nodeIds: options.nodeIds ?? [],
        spaceIds: options.spaceIds ?? [],
      }),
    )
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()
    return { harness, nodesBefore, ...hook }
  }

  it('clears the nodes, the Spaces and both React Flow flags on a pane click: one clear, no document write', () => {
    const { result, harness, nodesBefore } = setup({
      flagged: ['a', 'b'],
      nodeIds: ['a', 'b'],
      spaceIds: ['s'],
    })
    const spies = { select: vi.spyOn(result.current.selection, 'clear') }
    const others = [
      vi.spyOn(result.current.selection, 'select'),
      vi.spyOn(result.current.selection, 'setNodeIds'),
      vi.spyOn(result.current.selection, 'setSpaceIds'),
    ]

    act(() => result.current.interactions.handlePaneClick({ button: 0 } as React.MouseEvent))

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: [] })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    })
    expect(spies.select).toHaveBeenCalledTimes(1)
    others.forEach(spy => expect(spy).not.toHaveBeenCalled())
    expectNoDocumentWrite(harness, nodesBefore)
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
    // The nodes and the Spaces the marquee reads are the store's.
    const rowNodes = documentRow(['a', 'b', 'c'], options.flagged ?? [])
    const harness = createCanvasDocumentHarness({
      workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
      nodes: rowNodes,
      spaces: options.spaces ?? [],
    })
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    document.body.append(pane)
    const selectionDraftRef: { current: SelectionDraftState | null } = { current: null }
    const reactFlow = {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      // React Flow's nodes: the document's, without a read of the app store.
      getNodes: () => rowNodes,
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    const hook = renderHook(
      () => ({
        draft: useWorkspaceCanvasSelectionDraft({
          workspaceId: 'writers',
          isTrackpadCanvasMode: true,
          isShiftPressedRef: { current: false },
          selectionDraftRef,
          reactFlow,
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
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()
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
    return { harness, nodesBefore, pane, selectionDraftRef, pointerDown, pointerUp, ...hook }
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('writes the marquee result with one select and the flow flags, and no document write', () => {
    const { result, harness, nodesBefore, pointerDown, pointerUp } = setup({
      flagged: ['b'],
      nodeIds: ['b'],
    })
    const spies = spyOnCommands(result.current.selection)

    pointerDown(-50, -50)
    expect(pointerUp(350, 250)).toBe(true)

    expect(result.current.readSelection()).toMatchObject({ nodeIds: ['a'], spaceIds: [] })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: true,
      coveDragSurfaceSelectionMode: true,
    })
    expectOnlySelect(spies)
    expectNoDocumentWrite(harness, nodesBefore)
  })

  it('selects a touched Space and no window inside it with the same single command', () => {
    const { result, harness, nodesBefore, pointerDown, pointerUp } = setup({
      spaces: [createSpace('s', { x: 0, y: 0, width: 360, height: 260 }, ['a'])],
    })
    const spies = spyOnCommands(result.current.selection)

    pointerDown(-50, -50)
    pointerUp(350, 250)

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: ['s'] })
    // Nodes: none selected. A selected Space alone still turns the drag surface mode on.
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: true,
    })
    expectOnlySelect(spies)
    expectNoDocumentWrite(harness, nodesBefore)
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

  it('reads the Spaces once for each frame of the marquee, and subscribes to nothing', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)
      return frames.length
    })
    const { result, pointerDown } = setup({})
    pointerDown(-50, -50)
    frames.length = 0
    const subscribe = vi.spyOn(useAppStore, 'subscribe')
    const getState = vi.spyOn(useAppStore, 'getState')

    act(() =>
      result.current.draft.handleCanvasPointerMoveCapture({
        buttons: 1,
        clientX: 200,
        clientY: 150,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.PointerEvent<HTMLDivElement>),
    )
    // The move schedules the box frame and the selection frame; running both reads once.
    act(() => frames.splice(0).forEach(frame => frame(0)))
    expect(getState).toHaveBeenCalledTimes(1)

    act(() =>
      result.current.draft.handleCanvasPointerMoveCapture({
        buttons: 1,
        clientX: 250,
        clientY: 180,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.PointerEvent<HTMLDivElement>),
    )
    act(() => frames.splice(0).forEach(frame => frame(0)))
    expect(getState).toHaveBeenCalledTimes(2)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('captures the selected Spaces from the store when the marquee starts', () => {
    const { result, selectionDraftRef, pointerDown } = setup({ spaceIds: ['s'] })

    pointerDown(1000, 600)

    expect(selectionDraftRef.current?.selectedSpaceIdsAtStart).toEqual(['s'])
    expect(result.current.readSelection().spaceIds).toEqual(['s'])
  })

  it('clears nodes and Spaces with one clear when a click without drag ends a marquee', () => {
    const { result, harness, nodesBefore, pointerDown, pointerUp } = setup({
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
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    })
    expect(clear).toHaveBeenCalledTimes(1)
    others.forEach(spy => expect(spy).not.toHaveBeenCalled())
    expectNoDocumentWrite(harness, nodesBefore)
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
      nodes: documentRow(['a', 'b', 'c', 'd'], options.flagged ?? []),
      spaces: [
        createSpace('s', { x: -50, y: -50, width: 400, height: 400 }, ['a']),
        createSpace('t', { x: 1500, y: 0, width: 400, height: 400 }, []),
      ],
    })
    // The nodes as the store holds them, for the cases below that read positions.
    const holder = {
      get nodes() {
        return harness.readStoreDocument().nodes
      },
    }
    function useDragUnderTest({ workspaceId }: CanvasNodeStoreContext) {
      const flow = useReactFlow<Node<TerminalNodeData>>()
      return {
        drag: useWorkspaceCanvasSpaceDrag({
          workspaceId,
          reactFlow: { ...flow, screenToFlowPosition: point => point, getZoom: () => 1 },
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
    const nodesBefore = harness.readStoreDocument().nodes
    harness.notifications.mockClear()
    return { harness, nodesBefore, holder, down, up, ...hook }
  }

  it('selects the clicked Space with one select and the flow flags, and writes no document', () => {
    const { result, harness, nodesBefore, down } = setup({
      flagged: ['a', 'b'],
      nodeIds: ['a', 'b'],
    })
    const spies = spyOnCommands(result.current.selection)

    down('s', { x: 100, y: -40 })

    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: ['s'] })
    expect(result.current.readFlowFlags()).toEqual({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    })
    expectOnlySelect(spies)
    expectNoDocumentWrite(harness, nodesBefore)
  })

  it('writes no document for a whole click either, and none for a Shift toggle', () => {
    const { result, harness, nodesBefore, down, up } = setup({ nodeIds: ['b'], spaceIds: ['t'] })
    const spacesBefore = harness.readStoreDocument().spaces

    down('s', { x: 100, y: -40 })
    up({ x: 100, y: -40 })
    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: ['s'] })

    down('t', { x: 1600, y: 100 }, true)
    up({ x: 1600, y: 100 })
    expect(result.current.readSelection()).toMatchObject({ nodeIds: [], spaceIds: ['s', 't'] })
    expectNoDocumentWrite(harness, nodesBefore)
    expect(harness.readStoreDocument().spaces).toBe(spacesBefore)
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
    const { holder, down, up } = setup({ nodeIds: ['c'], spaceIds: ['s'] })
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

describe('the Spaces the selection hooks read (#702, PR 7)', () => {
  // Both hooks read the Spaces of the workspace whose render made them, from the store, when they
  // run. Each case writes the Spaces in the call that reads them, or between the two calls of one
  // gesture, then shows the other workspace and does it again.
  function seedTwoWorkspaces() {
    createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      nodes: createRowNodes(['a', 'b', 'c']),
    })
    useAppStore.setState(state => ({
      workspaces: [
        ...state.workspaces,
        { ...state.workspaces[0], id: 'workspace-b', nodes: createRowNodes(['a', 'b', 'c']) },
      ],
    }))
  }

  function switchableRender<Result>(useHook: () => Result) {
    let shown = 'workspace-a'
    const view = renderInCanvasDocument(useHook, { workspaceId: () => shown })
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

  it('scopes a toggle by the Spaces of the workspace of the render', () => {
    seedTwoWorkspaces()
    const { view, switchTo } = switchableRender(() => ({
      select: useWorkspaceCanvasSelectNode(),
      ...useStoreProbe(),
    }))
    const wide = { x: -50, y: -50, width: 1400, height: 400 }
    const narrow = { x: -50, y: -50, width: 700, height: 400 }

    // In A one Space holds a and b, and c is outside every Space: a is out of c's scope.
    act(() => {
      view.result.current.selection.select({ nodeIds: ['a'], spaceIds: [] })
      replaceSpacesInStore('workspace-a', [createSpace('s-a', narrow, ['a', 'b'])])
      view.result.current.select('c', { toggle: true })
    })
    expect(view.result.current.readSelection().nodeIds).toEqual(['c'])

    // In B one Space holds all three, and a stays selected.
    switchTo('workspace-b')
    act(() => {
      view.result.current.selection.select({ nodeIds: ['a'], spaceIds: [] })
      replaceSpacesInStore('workspace-b', [createSpace('s-b', wide, ['a', 'b', 'c'])])
      view.result.current.select('c', { toggle: true })
    })
    expect(view.result.current.readSelection().nodeIds).toEqual(['a', 'c'])
  })

  it('selects the Spaces the marquee touches in the workspace of the render, when it ends', () => {
    seedTwoWorkspaces()
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    document.body.append(pane)
    const selectionDraftRef: { current: SelectionDraftState | null } = { current: null }
    const reactFlow = {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getNodes: () => readWorkspaceDocument('workspace-a')?.nodes ?? [],
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    const { view, switchTo } = switchableRender(() => ({
      draft: useWorkspaceCanvasSelectionDraft({
        workspaceId: 'writers',
        isTrackpadCanvasMode: true,
        isShiftPressedRef: { current: false },
        selectionDraftRef,
        reactFlow,
      }),
      ...useStoreProbe(),
    }))
    const marquee = (workspaceId: string, spaceId: string) => {
      act(() =>
        view.result.current.draft.handleCanvasPointerDownCapture({
          button: 0,
          shiftKey: false,
          target: pane,
          clientX: -50,
          clientY: -50,
          pointerId: 1,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as React.PointerEvent<HTMLDivElement>),
      )
      // The Space reaches the store after the marquee started, as a Space created by another
      // writer would: a copy taken at the start does not hold it.
      act(() => {
        replaceSpacesInStore(workspaceId, [
          createSpace(spaceId, { x: 0, y: 0, width: 360, height: 260 }, ['a']),
        ])
        view.result.current.draft.handleCanvasPointerUpCapture({ clientX: 350, clientY: 250 })
      })
    }

    marquee('workspace-a', 's-a')
    expect(view.result.current.readSelection()).toMatchObject({ spaceIds: ['s-a'] })

    switchTo('workspace-b')
    marquee('workspace-b', 's-b')
    expect(view.result.current.readSelection()).toMatchObject({ spaceIds: ['s-b'] })
    document.body.innerHTML = ''
  })
})

describe('the selection writers read the document when they run', () => {
  // A window the store gained after the hook rendered: the hooks subscribe to nothing, so only a
  // read at call time sees it.
  function addWindowAfterRender(harness: CanvasDocumentHarness): void {
    act(() => {
      setDocumentNodes(harness.workspaceId, [
        ...harness.readStoreDocument().nodes,
        { ...documentRow(['n'])[0], position: { x: 800, y: 0 } },
      ])
    })
  }

  it('scopes a toggle of a window the store gained after the render', () => {
    const harness = createCanvasDocumentHarness({
      nodes: documentRow(['a', 'b']),
      spaces: [createSpace('s', { x: -50, y: -50, width: 1400, height: 400 }, ['a', 'b'])],
    })
    const view = renderInCanvasDocument(() => ({
      select: useWorkspaceCanvasSelectNode(),
      ...useStoreProbe(),
    }))
    act(() => view.result.current.selection.select({ nodeIds: ['a'], spaceIds: [] }))
    addWindowAfterRender(harness)

    act(() => view.result.current.select('n', { toggle: true }))

    expect(view.result.current.readSelection().nodeIds).toEqual(['a', 'n'])
  })

  it('selects with the marquee a window the store gained after the render', () => {
    // The release schedules frames that re-apply the marquee; this case reads the release only.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    const harness = createCanvasDocumentHarness({ nodes: documentRow(['a']) })
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    document.body.append(pane)
    const reactFlow = {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getNodes: () => harness.readStoreDocument().nodes,
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    const view = renderInCanvasDocument(() => ({
      draft: useWorkspaceCanvasSelectionDraft({
        workspaceId: harness.workspaceId,
        isTrackpadCanvasMode: true,
        isShiftPressedRef: { current: false },
        selectionDraftRef: { current: null },
        reactFlow,
      }),
      ...useStoreProbe(),
    }))
    addWindowAfterRender(harness)

    act(() =>
      view.result.current.draft.handleCanvasPointerDownCapture({
        button: 0,
        shiftKey: false,
        target: pane,
        clientX: 700,
        clientY: -50,
        pointerId: 1,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.PointerEvent<HTMLDivElement>),
    )
    act(() => {
      view.result.current.draft.handleCanvasPointerUpCapture({ clientX: 1200, clientY: 250 })
    })

    expect(view.result.current.readSelection().nodeIds).toEqual(['n'])
  })

  // The scope of a toggle is the Space whose rect holds the window's centre, not the Space's member
  // list: b sits inside s but is not one of its members.
  it('scopes a toggle by the Space rect that holds the window, not by its member list', () => {
    createCanvasDocumentHarness({
      nodes: documentRow(['a', 'b', 'c']),
      spaces: [createSpace('s', { x: -50, y: -50, width: 750, height: 400 }, ['a'])],
    })
    const view = renderInCanvasDocument(() => ({
      select: useWorkspaceCanvasSelectNode(),
      ...useStoreProbe(),
    }))
    act(() => view.result.current.selection.select({ nodeIds: ['a'], spaceIds: [] }))

    act(() => view.result.current.select('b', { toggle: true }))

    expect(view.result.current.readSelection().nodeIds).toEqual(['a', 'b'])
  })
})
