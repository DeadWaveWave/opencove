import { useRef } from 'react'
import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { vi } from 'vitest'
import { useWorkspaceCanvasApplyNodeChanges } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges'
import { useWorkspaceCanvasNodeDragSession } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import type { CanvasInteractionState } from '../../src/contexts/workspace/presentation/renderer/store/canvasStore.interaction'
import {
  useCanvasInteraction,
  useCanvasInteractionCommands,
  useCanvasSelectionCommands,
  useReadCanvasInteraction,
} from '../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../src/contexts/workspace/presentation/renderer/types'
import { applyLiveNodes } from '../../src/contexts/workspace/presentation/renderer/utils/canvasLiveNodes'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasNodeStoreContext,
} from './canvasDocumentHarness'
import type { RuntimeCanvasContext } from './agentRuntimeHarness'
import { createRowNodes } from './canvasSelectionFixtures'

// The canvas's change path wired as the canvas wires it, over the document harness: what a drag
// frame, a release and the other batches of React Flow do to the canvas store and the document.

const selectLiveNodes = (interaction: CanvasInteractionState) => interaction.liveNodes

export type DragContext = CanvasNodeStoreContext | RuntimeCanvasContext

export function useDragUnderTest({ workspaceId, canvasState, nodeStore, publishers }: DragContext) {
  const nodeDragSession = useWorkspaceCanvasNodeDragSession({ workspaceId })
  // The window whose selection a drag start replaced; null until a test says otherwise.
  const exclusiveNodeDragAnchorIdRef = useRef<string | null>(null)
  const apply = useWorkspaceCanvasApplyNodeChanges({
    onNodesChange: publishers.publishLiveNodesChange,
    onNodesCommit: publishers.commitNodesChange,
    onNodesRelease: publishers.commitNodesRelease,
    onSelectedNodeIdsChange: canvasState.syncSelectedNodeIds,
    clearAgentLaunchToken: nodeStore.clearAgentLaunchToken,
    normalizePosition: nodeStore.normalizePosition,
    applyPendingScrollbacks: nodeStore.applyPendingScrollbacks,
    nodes: canvasState.flowNodes,
    isNodeDraggingRef: nodeStore.isNodeDraggingRef,
    exclusiveNodeDragAnchorIdRef,
    nodeDragSession,
  })
  // What the flow host renders: the committed view with the overlay applied.
  const liveNodes = useCanvasInteraction(selectLiveNodes)
  const shown = applyLiveNodes(canvasState.flowNodes, liveNodes)
  return {
    apply,
    nodeDragSession,
    exclusiveNodeDragAnchorIdRef,
    selection: useCanvasSelectionCommands(),
    readInteraction: useReadCanvasInteraction(),
    interactionCommands: useCanvasInteractionCommands(),
    shown,
  }
}

/** Runs the animation frames a test collected, inside `act`. */
export function stubFrames() {
  const frames: Array<() => void> = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(() => callback(0))
    return frames.length
  })
  return () => act(() => frames.splice(0).forEach(frame => frame()))
}

export function sizedNode(node: Node<TerminalNodeData>): Node<TerminalNodeData> {
  return { ...node, initialWidth: node.data.width, initialHeight: node.data.height }
}

/** The nodes a, b and c of a row; the store holds them sized, as the canvas does. */
export const ROW = () => createRowNodes(['a', 'b', 'c']).map(sizedNode)

export const drag = (id: string, x: number, y: number) =>
  [{ type: 'position', id, position: { x, y }, dragging: true }] as never
export const drop = (id: string, x: number, y: number) =>
  [{ type: 'position', id, position: { x, y }, dragging: false }] as never

export function setupNodeDrag(
  nodes: Node<TerminalNodeData>[] = ROW(),
  options: { spaces?: WorkspaceSpaceState[]; magneticSnapping?: boolean } = {},
) {
  const harness = createCanvasDocumentHarness({ nodes, spaces: options.spaces })
  const view = renderCanvasNodeStore(harness, {
    extend: useDragUnderTest,
    magneticSnapping: options.magneticSnapping,
  })
  const runFrames = stubFrames()
  /** The y of node `id` as the host shows it, as the document holds it, and in the overlay. */
  const yOf = {
    shown: (id: string) => view.result.current.shown.find(node => node.id === id)?.position.y,
    stored: (id: string) =>
      harness.readStoreDocument().nodes.find(node => node.id === id)?.position.y,
    live: (id: string) => view.result.current.readInteraction().liveNodes?.get(id)?.position.y,
  }
  /** The ids the overlay holds, in order; null while no gesture is live. */
  const liveIds = () => {
    const live = view.result.current.readInteraction().liveNodes
    return live === null ? null : [...live.keys()]
  }
  /** Tells the session which window the pointer grabbed, as the canvas's drag start does. */
  const grab = (nodeId: string) => {
    view.result.current.nodeDragSession.nodeDragPointerAnchorRef.current = {
      nodeId,
      offset: { x: 0, y: 0 },
    }
  }
  return { harness, view, runFrames, yOf, liveIds, grab }
}
