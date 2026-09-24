import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { NodeExpandBehavior } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
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
  canvasRef,
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
  const storedState = useCanvasCollapseStore(
    store => store.workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE,
  )
  const state = useMemo(
    () => migrateLegacySpaceCollapse(storedState, spaces),
    [storedState, spaces],
  )
  const update = useCanvasCollapseStore(store => store.update)
  const { prepare: prepareMotion, getDelay: getMotionDelay } = useCollapseLayoutMotion(
    workspaceId,
    canvasRef,
  )
  useEffect(() => {
    if (state !== storedState) {
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
      if (current.collapsedNodeIds[id]) {
        prepareMotion('expand', plan.nodes, plan.spaces)
      }
      // Layout and disclosure commit together. Algorithm-only compact dimensions
      // must never enter the durable node store or the mounted runtime subtree.
      if (plan.nodes !== nodesRef.current) {
        setNodes(() => plan.nodes, { syncLayout: false })
        spacesRef.current = plan.spaces
        onSpacesChange(plan.spaces)
      }
      update(workspaceId, () => plan.state)
      if (
        !collapseMapsEqual(current.collapsedNodeIds, plan.state.collapsedNodeIds) ||
        !collapseMapsEqual(current.collapsedSpaceIds, plan.state.collapsedSpaceIds)
      ) {
        onRequestPersistFlush?.()
      }
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
      prepareMotion,
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
      // Collapse is a durable workspace preference as well as a local view
      // update. Schedule the canonical app-state write so the disclosure
      // survives an app restart even when the user collapses a node and quits
      // before another workspace mutation occurs.
      onRequestPersistFlush?.()
    },
    [
      nodesRef,
      update,
      workspaceId,
      expandNode,
      reactFlow,
      focusNodeTargetZoom,
      onRequestPersistFlush,
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

  const collapseAndArrange = useCallback(
    (spaceId: string) => {
      const current =
        useCanvasCollapseStore.getState().workspaces[workspaceId] ?? EMPTY_CANVAS_COLLAPSE
      const plan = planCollapsedArrangement(spaceId, nodesRef.current, spacesRef.current, current)
      if (!plan) {
        return
      }
      prepareMotion('arrange', plan.nodes, plan.spaces)
      setUndoHistory(previous => new Map(previous).set(spaceId, plan.snapshot))
      update(workspaceId, () => plan.state)
      setNodes(() => plan.nodes, { syncLayout: false })
      spacesRef.current = plan.spaces
      onSpacesChange(plan.spaces)
      onRequestPersistFlush?.()
    },
    [
      nodesRef,
      setNodes,
      spacesRef,
      update,
      workspaceId,
      onSpacesChange,
      prepareMotion,
      onRequestPersistFlush,
    ],
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
      prepareMotion('restore', restored.nodes, restored.spaces)
      update(workspaceId, () => restored.state)
      setNodes(() => restored.nodes, { syncLayout: false })
      spacesRef.current = restored.spaces
      onSpacesChange(restored.spaces)
      onRequestPersistFlush?.()
      setUndoHistory(previous => {
        const next = new Map(previous)
        next.delete(spaceId)
        return next
      })
    },
    [
      nodesRef,
      setNodes,
      spacesRef,
      update,
      workspaceId,
      onSpacesChange,
      undoHistory,
      prepareMotion,
      onRequestPersistFlush,
    ],
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
