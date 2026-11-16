import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { NodeExpandBehavior } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { useCanvasDocumentCommands, useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { useCanvasCollapseStore } from '../../../store/useCanvasCollapseStore'
import {
  EMPTY_CANVAS_COLLAPSE,
  migrateLegacySpaceCollapse,
  setCollapsed,
} from '../../../utils/canvasCollapse'
import {
  planCollapsedArrangement,
  restoreCollapsedArrangement,
  canRestoreCollapsedArrangement,
  type CollapseArrangeSnapshot,
} from '../../../utils/canvasCollapseArrange'
import { focusNodeInViewport } from '../helpers'
import type { UseWorkspaceCanvasNodesStoreResult } from '../hooks/useNodesStore.types'
import type { WorkspaceCollapseValue } from './WorkspaceCollapseContext'
import { planNodeExpansion } from './planNodeExpansion'
import { useCollapseLayoutMotion } from './useCollapseLayoutMotion'

function collapseMapsEqual(left: Record<string, true>, right: Record<string, true>): boolean {
  const leftIds = Object.keys(left)
  const rightIds = Object.keys(right)
  return leftIds.length === rightIds.length && leftIds.every(id => right[id] === true)
}

interface Params {
  workspaceId: string
  canvasRef?: RefObject<HTMLElement | null>
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  updateCanvasDocument: UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  focusNodeTargetZoom: number
  nodeExpandBehavior: NodeExpandBehavior
}

export function useCanvasCollapse({
  workspaceId,
  canvasRef,
  nodes,
  spaces,
  updateCanvasDocument,
  reactFlow,
  focusNodeTargetZoom,
  nodeExpandBehavior,
}: Params): WorkspaceCollapseValue & {
  expandNode: (id: string) => Node<TerminalNodeData> | undefined
} {
  const storedState = useCanvasCollapseStore(
    store => store.workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE,
  )
  const state = useMemo(
    // @compat canvas-space-collapse-legacy
    () => migrateLegacySpaceCollapse(storedState, spaces),
    [storedState, spaces],
  )
  const update = useCanvasCollapseStore(store => store.update)
  const readDocument = useReadCanvasDocument()
  const { requestPersistFlush } = useCanvasDocumentCommands()
  const { prepare: prepareMotion, getDelay: getMotionDelay } = useCollapseLayoutMotion(
    workspaceId,
    canvasRef,
  )
  useEffect(() => {
    if (state !== storedState) {
      // @compat canvas-space-collapse-legacy
      update(workspaceId, current => migrateLegacySpaceCollapse(current, spaces))
    }
  }, [state, storedState, spaces, workspaceId, update])
  const [undoHistory, setUndoHistory] = useState<ReadonlyMap<string, CollapseArrangeSnapshot>>(
    () => new Map(),
  )
  const emphasisTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setUndoHistory(new Map())
    return () => {
      if (emphasisTimer.current) {
        clearTimeout(emphasisTimer.current)
      }
    }
  }, [workspaceId])

  // The plan before the write decides whether to write and feeds the motion, the disclosure and
  // the return value. The write plans again from its own nodes and Spaces with the disclosure
  // captured above, as collapse-and-arrange and undo must.
  const expandNode = useCallback(
    (id: string) => {
      const current =
        useCanvasCollapseStore.getState().workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
      const document = readDocument()
      const plan = planNodeExpansion(
        id,
        document.nodes,
        document.spaces,
        current,
        nodeExpandBehavior,
      )
      if (!plan) {
        return undefined
      }
      if (current.collapsedNodeIds[id]) {
        prepareMotion('expand', plan.nodes, plan.spaces)
      }
      // Layout and disclosure commit together. Algorithm-only compact dimensions
      // must never enter the durable node store or the mounted runtime subtree.
      if (plan.nodes !== document.nodes) {
        updateCanvasDocument(
          input => {
            const committed = planNodeExpansion(
              id,
              input.nodes,
              input.spaces,
              current,
              nodeExpandBehavior,
            )
            return committed && committed.nodes !== input.nodes
              ? { nodes: committed.nodes, spaces: committed.spaces }
              : input
          },
          { syncLayout: false },
        )
      }
      update(workspaceId, () => plan.state)
      if (
        !collapseMapsEqual(current.collapsedNodeIds, plan.state.collapsedNodeIds) ||
        !collapseMapsEqual(current.collapsedSpaceIds, plan.state.collapsedSpaceIds)
      ) {
        requestPersistFlush()
      }
      return plan.nodes.find(node => node.id === id)
    },
    [
      nodeExpandBehavior,
      prepareMotion,
      readDocument,
      requestPersistFlush,
      update,
      updateCanvasDocument,
      workspaceId,
    ],
  )
  const toggleNode = useCallback(
    (id: string) => {
      const node = readDocument().nodes.find(item => item.id === id)
      if (!node) {
        return
      }
      if (useCanvasCollapseStore.getState().workspaces[workspaceId]?.collapsedNodeIds[id]) {
        const expanded = expandNode(id)
        if (expanded && expanded.position !== node.position) {
          focusNodeInViewport(reactFlow, expanded, { duration: 220, zoom: focusNodeTargetZoom })
        }
        return
      }
      update(workspaceId, current => ({
        ...current,
        collapsedNodeIds: setCollapsed(current.collapsedNodeIds, id, !current.collapsedNodeIds[id]),
      }))
      // Collapse is a durable workspace preference as well as a local view
      // update. Schedule the canonical app-state write so the disclosure
      // survives an app restart even when the user collapses a node and quits
      // before another workspace mutation occurs.
      requestPersistFlush()
    },
    [
      readDocument,
      update,
      workspaceId,
      expandNode,
      reactFlow,
      focusNodeTargetZoom,
      requestPersistFlush,
    ],
  )
  const revealNode = useCallback(
    (id: string) => {
      const node = expandNode(id)
      if (!node) {
        return
      }
      focusNodeInViewport(reactFlow, node, { duration: 220, zoom: focusNodeTargetZoom })
      const element = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(id)}"]`,
      )
      document
        .querySelectorAll('[data-cove-collapse-revealed]')
        .forEach(item => item.removeAttribute('data-cove-collapse-revealed'))
      element?.setAttribute('data-cove-collapse-revealed', 'true')
      if (emphasisTimer.current) {
        clearTimeout(emphasisTimer.current)
      }
      emphasisTimer.current = setTimeout(
        () => element?.removeAttribute('data-cove-collapse-revealed'),
        1200,
      )
    },
    [focusNodeTargetZoom, reactFlow, expandNode],
  )

  // Both plan before the write for what must happen before it (the motion, the undo entry and the
  // disclosure), and plan again inside it from the nodes and the Spaces it runs on. The second
  // plan uses the disclosure read before: `update` has already stored the new one by then, and an
  // undo would find nothing it could restore.
  const collapseAndArrange = useCallback(
    (spaceId: string) => {
      const current =
        useCanvasCollapseStore.getState().workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
      const document = readDocument()
      const plan = planCollapsedArrangement(spaceId, document.nodes, document.spaces, current)
      if (!plan) {
        return
      }
      prepareMotion('arrange', plan.nodes, plan.spaces)
      setUndoHistory(previous => new Map(previous).set(spaceId, plan.snapshot))
      update(workspaceId, () => plan.state)
      updateCanvasDocument(
        input => {
          const committed = planCollapsedArrangement(spaceId, input.nodes, input.spaces, current)
          return committed ? { nodes: committed.nodes, spaces: committed.spaces } : input
        },
        { syncLayout: false, flush: true },
      )
    },
    [prepareMotion, readDocument, update, updateCanvasDocument, workspaceId],
  )
  const undoArrange = useCallback(
    (spaceId: string) => {
      const snapshot = undoHistory.get(spaceId)
      if (!snapshot) {
        return
      }
      const current =
        useCanvasCollapseStore.getState().workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
      const document = readDocument()
      const restored = restoreCollapsedArrangement(
        snapshot,
        document.nodes,
        document.spaces,
        current,
      )
      prepareMotion('restore', restored.nodes, restored.spaces)
      update(workspaceId, () => restored.state)
      updateCanvasDocument(
        input => {
          const committed = restoreCollapsedArrangement(
            snapshot,
            input.nodes,
            input.spaces,
            current,
          )
          return { nodes: committed.nodes, spaces: committed.spaces }
        },
        { syncLayout: false, flush: true },
      )
      setUndoHistory(previous => {
        const next = new Map(previous)
        next.delete(spaceId)
        return next
      })
    },
    [prepareMotion, readDocument, undoHistory, update, updateCanvasDocument, workspaceId],
  )
  return useMemo(
    () => ({
      ...state,
      workspaceId,
      nodes,
      spaces,
      toggleNode,
      revealNode,
      expandNode,
      collapseAndArrange,
      undoArrange,
      canUndoArrange: (id: string) => {
        const snapshot = undoHistory.get(id)
        return Boolean(snapshot && canRestoreCollapsedArrangement(snapshot, nodes, spaces, state))
      },
      getMotionDelay,
    }),
    [
      state,
      workspaceId,
      nodes,
      spaces,
      toggleNode,
      revealNode,
      expandNode,
      collapseAndArrange,
      undoArrange,
      undoHistory,
      getMotionDelay,
    ],
  )
}
