import React from 'react'
import { act } from '@testing-library/react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasSelectionDraft } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectionDraft'
import { useWorkspaceCanvasLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useLifecycle'
import { createCanvasInputModalityState } from '../../../src/contexts/workspace/presentation/renderer/utils/inputModality'
import type { SelectionDraftState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { createNodeHolder, createRowNodes } from '../../support/canvasSelectionFixtures'
import { useWorkspaceCanvasState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasState'
import {
  useCanvasInteractionCommands,
  useReadCanvasInteraction,
  useReadCanvasSelection,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'

const NO_NODES: never[] = []
const NO_SPACES: never[] = []
const VIEWPORT = { x: 0, y: 0, zoom: 1 }
const DRAFT = { startX: 1, startY: 2, currentX: 3, currentY: 4, phase: 'active' } as const

// #738 Decision 2: the marquee rectangle and the snapping toggle are read by leaves. A frame of
// the marquee must not render the hook that WorkspaceCanvasInner calls for the canvas state.
describe('useWorkspaceCanvasState and the interaction slice', () => {
  function renderCanvasState() {
    let renders = 0
    const view = renderInCanvasDocument(() => {
      renders += 1
      return {
        canvasState: useWorkspaceCanvasState({
          nodes: NO_NODES,
          spaces: NO_SPACES,
          viewport: VIEWPORT,
        }),
        interaction: useCanvasInteractionCommands(),
      }
    })
    return { view, renders: () => renders }
  }

  it('does not render when the marquee rectangle changes', () => {
    const { view, renders } = renderCanvasState()
    const rendersBefore = renders()

    act(() => view.result.current.interaction.setSelectionDraft(DRAFT))
    act(() => view.result.current.interaction.setSelectionDraft({ ...DRAFT, currentX: 40 }))
    act(() => view.result.current.interaction.setSelectionDraft(null))

    expect(renders()).toBe(rendersBefore)
  })

  // #738, PR 3: the live nodes, the snap guides and the node-drag preview are read by the flow host
  // and the guides overlay. A frame of a node drag must not render this hook.
  it('does not render when the live nodes, the guides or the node-drag preview change', () => {
    const { view, renders } = renderCanvasState()
    const rendersBefore = renders()
    const { interaction } = view.result.current
    const frame = (y: number) => new Map([['a', { position: { x: 0, y }, dragging: true }]])

    act(() => interaction.publishLiveNodes(frame(10)))
    act(() => interaction.publishLiveNodes(frame(20)))
    act(() => interaction.setSnapGuides([{ kind: 'v', x: 1, y1: 0, y2: 10 }]))
    act(() =>
      interaction.setNodeDragFramePreview(new Map([['s', { x: 0, y: 0, width: 9, height: 9 }]])),
    )
    act(() => interaction.setNodeDragFramePreview(null))
    act(() => interaction.setSnapGuides(null))
    act(() => interaction.endLiveNodes())

    expect(renders()).toBe(rendersBefore)
  })

  it('does not render when the snapping toggle flips', () => {
    const { view, renders } = renderCanvasState()
    const rendersBefore = renders()

    act(() => view.result.current.interaction.toggleMagneticSnapping())
    act(() => view.result.current.interaction.toggleMagneticSnapping())

    expect(renders()).toBe(rendersBefore)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function pointer(x: number, y: number, buttons = 1) {
  return {
    button: 0,
    buttons,
    shiftKey: false,
    clientX: x,
    clientY: y,
    pointerId: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }
}

// A workspace switch during a marquee cancels it: the new store starts empty and the canvas
// lifecycle resets the draft ref (on main the rectangle stayed drawn in the new workspace).
describe('a marquee across a workspace switch', () => {
  it('leaves no marquee in the new workspace and selects nothing there', () => {
    createCanvasDocumentHarness({ workspaceId: 'workspace-a' })
    useAppStore.setState(state => ({
      workspaces: [...state.workspaces, { ...state.workspaces[0], id: 'workspace-b' }],
    }))
    const frames: Array<() => void> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(() => callback(0))
      return frames.length
    })
    const runFrames = () => act(() => frames.splice(0).forEach(frame => frame()))
    const holder = createNodeHolder(createRowNodes(['a', 'b', 'c']))
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    document.body.append(pane)
    const selectionDraftRef: { current: SelectionDraftState | null } = { current: null }
    const reactFlow = {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getNodes: () => holder.nodes,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setViewport: async () => true,
      zoomTo: async () => true,
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
    const refs = {
      trackpadGestureLockRef: { current: null },
      viewportRef: { current: { x: 0, y: 0, zoom: 1 } },
      inputModalityStateRef: { current: createCanvasInputModalityState('mouse') },
      isShiftPressedRef: { current: false },
      requestNodeDeleteRef: { current: vi.fn() },
    }
    let shown = 'workspace-a'
    const view = renderInCanvasDocument(
      () => {
        useWorkspaceCanvasLifecycle({
          workspaceId: shown,
          selectionDraftRef,
          trackpadGestureLockRef: refs.trackpadGestureLockRef,
          setIsCanvasWheelGestureCaptureActive: vi.fn(),
          reactFlow: reactFlow as never,
          viewport: { x: 0, y: 0, zoom: 1 },
          viewportRef: refs.viewportRef,
          canvasInputModeSetting: 'mouse',
          inputModalityStateRef: refs.inputModalityStateRef,
          setDetectedCanvasInputMode: vi.fn(),
          isShiftPressedRef: refs.isShiftPressedRef,
          setIsShiftPressed: vi.fn(),
          requestNodeDeleteRef: refs.requestNodeDeleteRef,
          focusNodeTargetZoom: 1,
          isFocusNodeTargetZoomPreviewing: false,
        })
        return {
          draft: useWorkspaceCanvasSelectionDraft({
            workspaceId: shown,
            isTrackpadCanvasMode: true,
            isShiftPressedRef: { current: false },
            selectionDraftRef,
            reactFlow,
            setNodes: holder.setNodes,
          }),
          readInteraction: useReadCanvasInteraction(),
          readSelection: useReadCanvasSelection(),
        }
      },
      { workspaceId: () => shown },
    )
    const down = (x: number, y: number) =>
      act(() =>
        view.result.current.draft.handleCanvasPointerDownCapture({
          ...pointer(x, y),
          target: pane,
        } as unknown as React.PointerEvent<HTMLDivElement>),
      )
    const move = (x: number, y: number, buttons = 1) =>
      act(() =>
        view.result.current.draft.handleCanvasPointerMoveCapture(
          pointer(x, y, buttons) as unknown as React.PointerEvent<HTMLDivElement>,
        ),
      )

    down(-50, -50)
    move(100, 100)
    runFrames()
    expect(view.result.current.readInteraction().selectionDraft).not.toBeNull()

    act(() => {
      shown = 'workspace-b'
      view.rerender()
    })
    expect(view.result.current.readInteraction().selectionDraft).toBeNull()

    // The same pointer keeps moving over the canvas, then hovers with no button: nothing of A's
    // marquee is drawn or committed in B.
    move(350, 250)
    runFrames()
    expect(view.result.current.readInteraction().selectionDraft).toBeNull()
    move(350, 250, 0)
    runFrames()
    expect(view.result.current.readSelection().nodeIds).toEqual([])
    expect(selectionDraftRef.current).toBeNull()
  })
})
