import { act, fireEvent } from '@testing-library/react'
import { useMemo } from 'react'
import type * as React from 'react'
import { useReactFlow, type Node } from '@xyflow/react'
import { vi } from 'vitest'
import { useAppStore } from '../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasSpaceDrag } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag'
import type { CanvasInteractionState } from '../../src/contexts/workspace/presentation/renderer/store/canvasStore.interaction'
import {
  useCanvasInteractionCommands,
  useCanvasSelectionCommands,
  useReadCanvasInteraction,
  useReadCanvasSelection,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  Point,
  TerminalNodeData,
} from '../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  renderInCanvasDocument,
  type CanvasDocumentHarness,
  type CanvasNodeStoreContext,
} from './canvasDocumentHarness'
import { createRowNodes, createSpace } from './canvasSelectionFixtures'

// A Space drag under test: the hook, the document harness and the pointer steps of a user. The
// hook's frames and its release run through window listeners and animation frames, as in the app.

export const SPACE_A_RECT = { x: 0, y: 0, width: 600, height: 400 }
export const INSIDE_A = { x: 300, y: 200 }

export function nodeAt(id: string, x: number, y: number): Node<TerminalNodeData> {
  return { ...createRowNodes([id])[0], position: { x, y } }
}

export function spaceA(nodeIds = ['n1']) {
  return createSpace('space-a', SPACE_A_RECT, nodeIds)
}

export function spaceC() {
  return createSpace('space-c', { x: 700, y: 0, width: 500, height: 400 }, [])
}

function useDragUnderTest({ workspaceId }: CanvasNodeStoreContext) {
  const flow = useReactFlow<Node<TerminalNodeData>>()
  return {
    drag: useWorkspaceCanvasSpaceDrag({
      workspaceId,
      reactFlow: { ...flow, screenToFlowPosition: point => point, getZoom: () => 1 },
    }),
    selection: useCanvasSelectionCommands(),
    readSelection: useReadCanvasSelection(),
    interaction: useCanvasInteractionCommands(),
    readInteraction: useReadCanvasInteraction(),
  }
}

export interface DragView {
  result: {
    current: {
      drag: Pick<ReturnType<typeof useWorkspaceCanvasSpaceDrag>, 'handleSpaceDragHandlePointerDown'>
      readInteraction: () => CanvasInteractionState
      readSelection: () => { nodeIds: readonly string[]; spaceIds: readonly string[] }
      interaction: { setSnapGuides: (guides: never) => void }
    }
  }
}

export function renderDrag(
  harness: CanvasDocumentHarness,
  options: { magneticSnapping?: boolean } = {},
) {
  return renderCanvasNodeStore(harness, { extend: useDragUnderTest, ...options })
}

export function press(
  view: DragView,
  spaceId: string,
  point: { x: number; y: number },
  shiftKey = false,
) {
  act(() =>
    view.result.current.drag.handleSpaceDragHandlePointerDown(
      {
        button: 0,
        shiftKey,
        clientX: point.x,
        clientY: point.y,
        pointerId: 7,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.PointerEvent<HTMLDivElement>,
      spaceId,
    ),
  )
}

/** One frame: a pointer move, and the animation frame it schedules (fake timers). */
export function dragTo(point: { x: number; y: number }) {
  act(() => {
    fireEvent.pointerMove(window, { pointerId: 7, clientX: point.x, clientY: point.y, buttons: 1 })
    vi.advanceTimersByTime(20)
  })
}

export function release(point: { x: number; y: number }) {
  act(() => {
    fireEvent.pointerUp(window, { pointerId: 7, clientX: point.x, clientY: point.y })
  })
}

/**
 * A canvas that switches between workspace A and B, as the app does: one hook instance, a canvas
 * store for each workspace id, writers of the workspace shown now.
 */
export function renderSwitchingSpaceDrag() {
  const harness = createCanvasDocumentHarness({
    workspaceId: 'workspace-a',
    nodes: [nodeAt('n1', 50, 60)],
    spaces: [spaceA()],
  })
  useAppStore.setState(state => ({
    workspaces: [
      ...state.workspaces,
      {
        ...state.workspaces[0],
        id: 'workspace-b',
        nodes: [nodeAt('b1', 50, 60)],
        spaces: [createSpace('space-b', SPACE_A_RECT, ['b1'])],
      },
    ],
  }))
  let shown = 'workspace-a'
  const view = renderInCanvasDocument(
    () => {
      const flow = useReactFlow<Node<TerminalNodeData>>()
      // Stable, as in the app: a changed instance would hide a dependency lost by a callback.
      const reactFlow = useMemo(
        () => ({ ...flow, screenToFlowPosition: (point: Point) => point, getZoom: () => 1 }),
        [flow],
      )
      return {
        interaction: useCanvasInteractionCommands(),
        readInteraction: useReadCanvasInteraction(),
        drag: useWorkspaceCanvasSpaceDrag({
          workspaceId: shown,
          reactFlow,
        }),
      }
    },
    { workspaceId: () => shown },
  )
  return {
    harness,
    view,
    switchTo: (id: string) => {
      shown = id
      view.rerender()
    },
  }
}
