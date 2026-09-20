import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { NodeExpandBehavior } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { useCanvasCollapseStore } from '../../../store/useCanvasCollapseStore'
import { EMPTY_CANVAS_COLLAPSE, setCollapsed } from '../../../utils/canvasCollapse'
import {
  planCollapsedArrangement,
  restoreCollapsedArrangement,
  type CollapseArrangeSnapshot,
} from '../../../utils/canvasCollapseArrange'
import { focusNodeInViewport } from '../helpers'
import type { WorkspaceCollapseValue } from './WorkspaceCollapseContext'
import { planNodeExpansion } from './planNodeExpansion'

interface Params {
  workspaceId: string
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  setNodes: (
    updater: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  focusNodeTargetZoom: number
  nodeExpandBehavior: NodeExpandBehavior
  onRequestPersistFlush?: () => void
}

export function useCanvasCollapse({
  workspaceId,
  nodes,
  spaces,
  nodesRef,
  spacesRef,
  setNodes,
  onSpacesChange,
  reactFlow,
  focusNodeTargetZoom,
  nodeExpandBehavior,
  onRequestPersistFlush,
}: Params): WorkspaceCollapseValue & {
  expandNode: (id: string) => Node<TerminalNodeData> | undefined
} {
  const state = useCanvasCollapseStore(
    store => store.workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE,
  )
  const update = useCanvasCollapseStore(store => store.update)
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

  const expandNode = useCallback(
    (id: string) => {
      const current =
        useCanvasCollapseStore.getState().workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
      const plan = planNodeExpansion(
        id,
        nodesRef.current,
        spacesRef.current,
        current,
        nodeExpandBehavior,
      )
      if (!plan) {
        return undefined
      }
      // Layout and disclosure commit together. Algorithm-only compact dimensions
      // must never enter the durable node store or the mounted runtime subtree.
      if (plan.nodes !== nodesRef.current) {
        setNodes(() => plan.nodes, { syncLayout: false })
        spacesRef.current = plan.spaces
        onSpacesChange(plan.spaces)
        onRequestPersistFlush?.()
      }
      update(workspaceId, () => plan.state)
      return plan.nodes.find(node => node.id === id)
    },
    [
      nodeExpandBehavior,
      nodesRef,
      spacesRef,
      workspaceId,
      setNodes,
      onSpacesChange,
      onRequestPersistFlush,
      update,
    ],
  )
  const toggleNode = useCallback(
    (id: string) => {
      const node = nodesRef.current.find(item => item.id === id)
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
    },
    [nodesRef, update, workspaceId, expandNode, reactFlow, focusNodeTargetZoom],
  )
  const toggleSpace = useCallback(
    (id: string) => {
      if (!spacesRef.current.some(space => space.id === id)) {
        return
      }
      update(workspaceId, current => ({
        ...current,
        collapsedSpaceIds: setCollapsed(
          current.collapsedSpaceIds,
          id,
          !current.collapsedSpaceIds[id],
        ),
      }))
    },
    [spacesRef, update, workspaceId],
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

  const collapseAndArrange = useCallback(
    (spaceId: string) => {
      const current =
        useCanvasCollapseStore.getState().workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
      const plan = planCollapsedArrangement(spaceId, nodesRef.current, spacesRef.current, current)
      if (!plan) {
        return
      }
      setUndoHistory(previous => new Map(previous).set(spaceId, plan.snapshot))
      update(workspaceId, () => plan.state)
      setNodes(() => plan.nodes, { syncLayout: false })
      onSpacesChange(plan.spaces)
    },
    [nodesRef, setNodes, spacesRef, update, workspaceId, onSpacesChange],
  )
  const undoArrange = useCallback(
    (spaceId: string) => {
      const snapshot = undoHistory.get(spaceId)
      if (!snapshot) {
        return
      }
      const current =
        useCanvasCollapseStore.getState().workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
      const restored = restoreCollapsedArrangement(
        snapshot,
        nodesRef.current,
        spacesRef.current,
        current,
      )
      update(workspaceId, () => restored.state)
      setNodes(() => restored.nodes, { syncLayout: false })
      onSpacesChange(restored.spaces)
      setUndoHistory(previous => {
        const next = new Map(previous)
        next.delete(spaceId)
        return next
      })
    },
    [nodesRef, setNodes, spacesRef, update, workspaceId, onSpacesChange, undoHistory],
  )
  return useMemo(
    () => ({
      ...state,
      workspaceId,
      nodes,
      spaces,
      toggleNode,
      toggleSpace,
      revealNode,
      expandNode,
      collapseAndArrange,
      undoArrange,
      canUndoArrange: (id: string) => undoHistory.has(id),
    }),
    [
      state,
      workspaceId,
      nodes,
      spaces,
      toggleNode,
      toggleSpace,
      revealNode,
      expandNode,
      collapseAndArrange,
      undoArrange,
      undoHistory,
    ],
  )
}
