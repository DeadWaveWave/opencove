import { killUnownedNodeRuntime } from '../../../utils/managedClaudeLifecycle'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { applyNodeChanges } from '@xyflow/react'
import type { Node, NodeChange, NodePositionChange } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { applyLiveNodes, toLiveNodes } from '../../../utils/canvasLiveNodes'
import { cleanupNodeRuntimeArtifacts } from '../../../utils/nodeRuntimeCleanup'
import {
  useCanvasInteractionCommands,
  useCanvasWorkspaceId,
  useReadCanvasDocument,
  useReadCanvasInteraction,
} from '../../../store/canvasStoreContext'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../terminalNode/constants'
import { resolveGrabbedNodeId, type UseApplyNodeChangesParams } from './useApplyNodeChanges.helpers'
import { useDecorateCommittedNodes } from './useDecorateCommittedNodes'
import { publishWorkspaceNodesClosed } from '../nodeClosureEvents'

type WorkspaceNodeChange = NodeChange<Node<TerminalNodeData>>
type ContinuousDragPositionChange = NodePositionChange & { dragging: true }

const MULTI_NODE_CONTINUOUS_DRAG_MIN_FRAME_MS = 24

function isContinuousDragPositionChange(
  change: WorkspaceNodeChange,
): change is ContinuousDragPositionChange {
  return change.type === 'position' && change.dragging !== false
}

function toContinuousDragPositionChanges(
  changes: WorkspaceNodeChange[],
): ContinuousDragPositionChange[] | null {
  if (changes.length === 0) {
    return null
  }

  const positionChanges = changes.filter(isContinuousDragPositionChange)
  return positionChanges.length === changes.length ? positionChanges : null
}

function mergeContinuousDragPositionChanges(
  previousChanges: ContinuousDragPositionChange[] | null,
  nextChanges: ContinuousDragPositionChange[],
): ContinuousDragPositionChange[] {
  if (!previousChanges) {
    return nextChanges
  }

  const nextPositionChangeById = new Map<string, ContinuousDragPositionChange>()
  for (const change of previousChanges) {
    nextPositionChangeById.set(change.id, change)
  }

  for (const change of nextChanges) {
    nextPositionChangeById.set(change.id, change)
  }

  return [...nextPositionChangeById.values()]
}

function resolveContinuousDragMinFrameMs(changes: ContinuousDragPositionChange[]): number {
  const changedNodeIds = new Set(changes.map(change => change.id))
  return changedNodeIds.size > 1 ? MULTI_NODE_CONTINUOUS_DRAG_MIN_FRAME_MS : 0
}

/**
 * Takes removed windows out of `nodes` and unlinks what pointed at them: a task loses its linked
 * agent, an agent its task. Returns `nodes` itself when no window of it is removed or linked.
 */
export function removeNodesAndUnlink(
  nodes: Node<TerminalNodeData>[],
  removedIds: ReadonlySet<string>,
): Node<TerminalNodeData>[] {
  if (removedIds.size === 0) {
    return nodes
  }

  const now = new Date().toISOString()
  let didChange = false

  const next = nodes.flatMap(node => {
    if (removedIds.has(node.id)) {
      didChange = true
      return []
    }

    if (
      node.data.kind === 'task' &&
      node.data.task &&
      node.data.task.linkedAgentNodeId &&
      removedIds.has(node.data.task.linkedAgentNodeId)
    ) {
      didChange = true
      return [
        {
          ...node,
          data: {
            ...node.data,
            task: {
              ...node.data.task,
              linkedAgentNodeId: null,
              status: node.data.task.status === 'doing' ? 'todo' : node.data.task.status,
              updatedAt: now,
            },
          },
        },
      ]
    }

    if (
      node.data.kind === 'agent' &&
      node.data.agent &&
      node.data.agent.taskId &&
      removedIds.has(node.data.agent.taskId)
    ) {
      didChange = true
      return [
        {
          ...node,
          data: {
            ...node.data,
            agent: {
              ...node.data.agent,
              taskId: null,
            },
          },
        },
      ]
    }

    return [node]
  })

  return didChange ? next : nodes
}

function resolveNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

export function useWorkspaceCanvasApplyNodeChanges({
  onNodesChange,
  onNodesCommit,
  onNodesRelease,
  onSelectedNodeIdsChange,
  clearAgentLaunchToken,
  normalizePosition,
  applyPendingScrollbacks,
  nodes,
  isNodeDraggingRef,
  exclusiveNodeDragAnchorIdRef,
  nodeDragSession,
}: UseApplyNodeChangesParams): (changes: NodeChange<Node<TerminalNodeData>>[]) => void {
  const workspaceId = useCanvasWorkspaceId()
  const readDocument = useReadCanvasDocument()
  const decorateCommittedNodes = useDecorateCommittedNodes()
  const readInteraction = useReadCanvasInteraction()
  const { endLiveNodes } = useCanvasInteractionCommands()
  const pendingContinuousDragChangesRef = useRef<ContinuousDragPositionChange[] | null>(null)
  const pendingContinuousDragFrameRef = useRef<number | null>(null)
  const lastContinuousDragFlushAtRef = useRef(0)

  // This hook is the one writer of the dragging flag and of the exclusive anchor: a batch sets
  // them, and the end of a gesture that gets no release (an abort, a workspace switch) clears them.
  const setNodeDragging = useCallback(
    (isDragging: boolean) => {
      isNodeDraggingRef.current = isDragging
    },
    [isNodeDraggingRef],
  )
  const clearExclusiveAnchor = useCallback(() => {
    if (exclusiveNodeDragAnchorIdRef) {
      exclusiveNodeDragAnchorIdRef.current = null
    }
  }, [exclusiveNodeDragAnchorIdRef])

  const applyNodeChangeBatch = useCallback(
    (changes: WorkspaceNodeChange[]) => {
      const wasDragging = isNodeDraggingRef.current
      const exclusiveAnchorId = exclusiveNodeDragAnchorIdRef?.current ?? null
      const filteredChanges = changes
        .filter(
          change =>
            change.type !== 'add' && change.type !== 'replace' && change.type !== 'dimensions',
        )
        .filter(change => {
          if (!exclusiveAnchorId) {
            return true
          }

          return change.type !== 'position' || change.id === exclusiveAnchorId
        })

      if (!filteredChanges.length) {
        return
      }

      const removedIds = new Set(
        filteredChanges.filter(change => change.type === 'remove').map(change => change.id),
      )
      const positionChanges = filteredChanges.filter(
        (change): change is NodePositionChange =>
          change.type === 'position' && !removedIds.has(change.id),
      )
      const isDraggingThisFrame = positionChanges.some(change => change.dragging !== false)
      const isRelease = wasDragging && !isDraggingThisFrame

      // The base is read from the stores when the batch runs (S6, PR 4). A drag frame and a release
      // compute from the live view, what React Flow shows now; every other batch from the
      // committed view, so a live overlay that no gesture of this hook owns never reaches it.
      const committedNodes = decorateCommittedNodes(readDocument().nodes)
      const currentNodes =
        isDraggingThisFrame || isRelease
          ? applyLiveNodes(committedNodes, readInteraction().liveNodes)
          : committedNodes
      if (removedIds.size > 0) {
        removedIds.forEach(removedId => {
          clearAgentLaunchToken(removedId)
        })

        currentNodes.forEach(node => {
          if (!removedIds.has(node.id)) {
            return
          }

          if (node.data.sessionId.length > 0) {
            cleanupNodeRuntimeArtifacts(node.id, node.data.sessionId)
            void killUnownedNodeRuntime(node).catch(() => undefined)
          }
        })
      }

      const survivingNodes = currentNodes.filter(node => !removedIds.has(node.id))
      const nonRemoveChanges = filteredChanges.filter(change => change.type !== 'remove')

      let nextNodes = applyNodeChanges<Node<TerminalNodeData>>(nonRemoveChanges, survivingNodes)

      const settledPositionChanges: NodePositionChange[] = filteredChanges.filter(
        (change): change is NodePositionChange =>
          change.type === 'position' &&
          change.dragging === false &&
          change.position !== undefined &&
          !removedIds.has(change.id),
      )

      if (!wasDragging && isDraggingThisFrame) {
        nodeDragSession.beginNodeDragSession(currentNodes)
      }

      // What a release writes besides the windows, and the baseline it compares them with: both are
      // gone once the session ends.
      let releaseBaseline: ReadonlyMap<string, { x: number; y: number }> | null = null
      let releaseSpaceRects: ReturnType<typeof nodeDragSession.endNodeDragSession> = null
      if (isRelease) {
        nextNodes = nodeDragSession.applyPendingReleaseProjection(nextNodes)
        releaseBaseline = nodeDragSession.dragBaselinePositionByIdRef.current
        releaseSpaceRects = nodeDragSession.endNodeDragSession()
      }

      if (settledPositionChanges.length > 0) {
        if (!wasDragging) {
          nextNodes = nextNodes.map(node => {
            const settledChange = settledPositionChanges.find(change => change.id === node.id)
            if (!settledChange || !settledChange.position) {
              return node
            }

            const resolved = normalizePosition(node.id, settledChange.position, {
              width: node.data.width,
              height: node.data.height,
            })

            return {
              ...node,
              position: resolved,
            }
          })
        }
      }

      const anchorChange = positionChanges.find(change => change.position !== undefined) ?? null

      if (isDraggingThisFrame) {
        const draggingIds = positionChanges
          .filter(change => change.dragging !== false)
          .map(change => change.id)
        const draggedNodeIds = [...new Set(draggingIds)]

        const desiredDraggedPositionById = new Map<string, { x: number; y: number }>()
        for (const nodeId of draggedNodeIds) {
          const node = nextNodes.find(candidate => candidate.id === nodeId)
          if (!node) {
            continue
          }

          desiredDraggedPositionById.set(nodeId, {
            x: node.position.x,
            y: node.position.y,
          })
        }

        const anchorNodeId =
          positionChanges.find(change => change.dragging !== false && change.position !== undefined)
            ?.id ?? draggedNodeIds[0]

        const dropFlowPoint =
          draggedNodeIds.length === 1 &&
          nodeDragSession.nodeDragPointerAnchorRef.current?.nodeId === draggedNodeIds[0] &&
          desiredDraggedPositionById.get(draggedNodeIds[0])
            ? (() => {
                const anchor = nodeDragSession.nodeDragPointerAnchorRef.current!
                const desired = desiredDraggedPositionById.get(draggedNodeIds[0])!
                return { x: desired.x + anchor.offset.x, y: desired.y + anchor.offset.y }
              })()
            : null

        const prevAnchor = anchorChange
          ? (currentNodes.find(node => node.id === anchorChange.id) ?? null)
          : null
        const anchorIsSelected = prevAnchor?.selected === true
        nextNodes = nodeDragSession.projectNodeDrag({
          currentNodes: nextNodes,
          draggedNodeIds,
          desiredDraggedPositionById,
          dropFlowPoint,
          anchorNodeId,
          anchorIsSelected,
        }).nextNodes
      }

      if (positionChanges.length > 0) {
        setNodeDragging(isDraggingThisFrame)
      }

      if (exclusiveAnchorId && positionChanges.length > 0 && !isDraggingThisFrame) {
        clearExclusiveAnchor()
      }

      if (!isNodeDraggingRef.current) {
        nextNodes = applyPendingScrollbacks(nextNodes)
      }

      nextNodes = removeNodesAndUnlink(nextNodes, removedIds)

      const shouldSyncLayout = filteredChanges.some(change => {
        if (change.type === 'remove') {
          return true
        }

        if (change.type === 'position') {
          return change.dragging === false
        }

        return true
      })

      if (filteredChanges.some(change => change.type === 'select' || change.type === 'remove')) {
        // Publish selection in the same transaction as the node change. Mirroring
        // React Flow's later SelectionListener effect can replay an older selection
        // after controlled nodes have already changed, creating a feedback loop.
        onSelectedNodeIdsChange?.(nextNodes.filter(node => node.selected).map(node => node.id))
      }
      // A drag frame publishes the gesture's windows, a release writes them (and the Space frames)
      // in one commit and then ends the overlay, and any other batch writes its whole result. A
      // batch that changes no window this canvas holds writes nothing, whatever its kind.
      const changesHeldNode = filteredChanges.some(change =>
        currentNodes.some(node => node.id === change.id),
      )
      if (isRelease) {
        // The document first, the overlay after it, in this one block: a render between the two
        // shows the overlay over the released nodes, never the nodes before the drag. The write
        // applies the entries of the windows the store still holds and nothing else, so a release
        // of windows that are all gone from here writes nothing; it still ends the gesture.
        onNodesRelease({
          liveNodes: toLiveNodes(nextNodes, releaseBaseline, committedNodes),
          removedIds,
          spaceRects: releaseSpaceRects,
        })
        endLiveNodes()
      } else if (changesHeldNode && isDraggingThisFrame) {
        onNodesChange(
          toLiveNodes(
            nextNodes,
            nodeDragSession.dragBaselinePositionByIdRef.current,
            committedNodes,
          ),
        )
      } else if (changesHeldNode) {
        onNodesCommit(nextNodes)
      }
      if (removedIds.size > 0) {
        const survivingIds = new Set(nextNodes.map(node => node.id))
        publishWorkspaceNodesClosed(
          currentNodes
            .filter(node => removedIds.has(node.id) && !survivingIds.has(node.id))
            .map(node => node.id),
        )
      }
      if (shouldSyncLayout) {
        window.dispatchEvent(new Event(TERMINAL_LAYOUT_SYNC_EVENT))
      }
    },
    [
      applyPendingScrollbacks,
      clearAgentLaunchToken,
      clearExclusiveAnchor,
      exclusiveNodeDragAnchorIdRef,
      isNodeDraggingRef,
      nodeDragSession,
      normalizePosition,
      onNodesCommit,
      onNodesChange,
      onNodesRelease,
      onSelectedNodeIdsChange,
      readDocument,
      readInteraction,
      decorateCommittedNodes,
      endLiveNodes,
      setNodeDragging,
    ],
  )

  const flushPendingContinuousDragChanges = useCallback(
    (flushedAt: number = resolveNow()) => {
      const pendingChanges = pendingContinuousDragChangesRef.current
      pendingContinuousDragChangesRef.current = null
      pendingContinuousDragFrameRef.current = null

      if (!pendingChanges) {
        return
      }

      lastContinuousDragFlushAtRef.current = flushedAt
      applyNodeChangeBatch(pendingChanges)
    },
    [applyNodeChangeBatch],
  )

  const cancelPendingContinuousDragFrame = useCallback(() => {
    if (pendingContinuousDragFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingContinuousDragFrameRef.current)
    pendingContinuousDragFrameRef.current = null
  }, [])

  const scheduleContinuousDragFrame = useCallback(() => {
    if (pendingContinuousDragFrameRef.current !== null) {
      return
    }

    if (typeof window.requestAnimationFrame !== 'function') {
      flushPendingContinuousDragChanges()
      return
    }

    pendingContinuousDragFrameRef.current = window.requestAnimationFrame(now => {
      pendingContinuousDragFrameRef.current = null
      const pendingChanges = pendingContinuousDragChangesRef.current
      if (!pendingChanges) {
        return
      }

      const minFrameMs = resolveContinuousDragMinFrameMs(pendingChanges)
      if (
        minFrameMs > 0 &&
        lastContinuousDragFlushAtRef.current > 0 &&
        now - lastContinuousDragFlushAtRef.current < minFrameMs
      ) {
        scheduleContinuousDragFrame()
        return
      }

      flushPendingContinuousDragChanges(now)
    })
  }, [flushPendingContinuousDragChanges])

  const scheduleContinuousDragChanges = useCallback(
    (changes: ContinuousDragPositionChange[]) => {
      pendingContinuousDragChangesRef.current = mergeContinuousDragPositionChanges(
        pendingContinuousDragChangesRef.current,
        changes,
      )
      scheduleContinuousDragFrame()
    },
    [scheduleContinuousDragFrame],
  )

  const discardPendingContinuousDrag = useCallback(() => {
    cancelPendingContinuousDragFrame()
    pendingContinuousDragChangesRef.current = null
  }, [cancelPendingContinuousDragFrame])

  useEffect(() => discardPendingContinuousDrag, [discardPendingContinuousDrag])

  // The canvas is not keyed by workspace. A drag that was live when the user switched cannot be
  // finished here, and React Flow may never send its release, so the next workspace's drag must
  // not start as a continuation of it (`wasDragging` would skip its session).
  useLayoutEffect(() => {
    setNodeDragging(false)
  }, [setNodeDragging, workspaceId])

  // React Flow aborts a node-handle drag when the window it grabbed leaves its node lookup, and
  // sends no release after it. The removal arrives as a write from elsewhere, not as a change
  // batch, so only a reaction to the committed nodes sees it when it happens; the next batch would
  // be the user's next click, which would act as the release. The gesture ends here with nothing
  // written: no window reaches the document, as for any other drag that does not finish.
  useEffect(() => {
    if (!isNodeDraggingRef.current) {
      return
    }

    const grabbedNodeId = resolveGrabbedNodeId(
      nodeDragSession.nodeDragPointerAnchorRef.current,
      readInteraction().liveNodes,
    )
    if (grabbedNodeId === null || nodes.some(node => node.id === grabbedNodeId)) {
      return
    }

    // A frame still waiting for its animation frame must not start the gesture again.
    discardPendingContinuousDrag()
    setNodeDragging(false)
    clearExclusiveAnchor()
    nodeDragSession.clearDragStartSpaceSelection()
    nodeDragSession.endNodeDragSession()
    endLiveNodes()
  }, [
    clearExclusiveAnchor,
    discardPendingContinuousDrag,
    endLiveNodes,
    isNodeDraggingRef,
    nodeDragSession,
    nodes,
    readInteraction,
    setNodeDragging,
  ])

  return useCallback(
    (changes: WorkspaceNodeChange[]) => {
      const continuousDragChanges = toContinuousDragPositionChanges(changes)
      if (continuousDragChanges) {
        scheduleContinuousDragChanges(continuousDragChanges)
        return
      }

      if (pendingContinuousDragChangesRef.current) {
        cancelPendingContinuousDragFrame()
        flushPendingContinuousDragChanges()
      }

      applyNodeChangeBatch(changes)
    },
    [
      applyNodeChangeBatch,
      cancelPendingContinuousDragFrame,
      flushPendingContinuousDragChanges,
      scheduleContinuousDragChanges,
    ],
  )
}
