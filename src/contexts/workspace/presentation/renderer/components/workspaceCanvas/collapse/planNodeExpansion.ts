import type { Node } from '@xyflow/react'
import type { NodeExpandBehavior } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { revealCollapsedNode, type CanvasCollapseState } from '../../../utils/canvasCollapse'
import {
  projectCanvasInteractionLayout,
  restoreCanvasInteractionLayout,
} from '../../../utils/canvasInteractionLayout'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { SPACE_NODE_PADDING } from '../../../utils/spaceLayout'
import { resolveAncestorSpaceIds, buildSpaceById } from '../../../utils/spaceTreeLayout'
import { resolveNodesPlacement } from '../hooks/useNodesStore.resolvePlacement'
import { resolveWorkspaceLayoutAfterNodeResize } from '../hooks/useNodesStore.resolveResizeLayout'

interface ExpansionPlan {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  state: CanvasCollapseState
}

function findExpansionSpace(
  target: Node<TerminalNodeData>,
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
): { nodes: Node<TerminalNodeData>[]; spaces: WorkspaceSpaceState[] } | null {
  const owner = spaces.find(space => space.nodeIds.includes(target.id))
  const peers = nodes.filter(node => node.id !== target.id)
  const ancestors = new Set(owner ? resolveAncestorSpaceIds(owner.id, buildSpaceById(spaces)) : [])
  const outsideObstacles = spaces.flatMap(space =>
    !ancestors.has(space.id) && space.rect ? [space.rect] : [],
  )
  const options = {
    anchor: target.position,
    size: target.data,
    getNodes: () => peers,
    getSpaceRects: () => spaces.flatMap(space => (space.rect ? [space.rect] : [])),
    targetSpaceRect: owner?.rect,
  }
  const unboundedOptions = {
    ...options,
    targetSpaceRect: null,
    getSpaceRects: () => outsideObstacles,
  }
  let placement = resolveNodesPlacement(options)
  if (!placement.canPlace && owner) {
    // A packed nested Space can have no valid creation anchor. Keep ownership,
    // find room beyond its current frame, then grow that frame around the node.
    placement = resolveNodesPlacement(unboundedOptions)
  }
  if (!placement.canPlace) {
    // Creation searches nearby first. A narrow corridor between large Spaces
    // can exhaust that search, so retry beyond every visible obstacle's edge.
    const rightmostEdge = Math.max(
      target.position.x,
      ...peers.map(node => node.position.x + node.data.width),
      ...outsideObstacles.map(rect => rect.x + rect.width),
    )
    placement = resolveNodesPlacement({
      ...unboundedOptions,
      anchor: { x: rightmostEdge + SPACE_NODE_PADDING * 2, y: target.position.y },
    })
  }
  if (!placement.canPlace) {
    return null
  }
  const nextNodes = nodes.map(node =>
    node.id === target.id ? { ...target, position: placement.placement } : node,
  )
  if (!owner) {
    return { nodes: nextNodes, spaces }
  }
  const expanded = expandSpaceToFitOwnedNodesAndPushAway({
    targetSpaceId: owner.id,
    spaces,
    nodeRects: nextNodes.map(node => ({
      id: node.id,
      rect: { ...node.position, width: node.data.width, height: node.data.height },
    })),
    gap: 0,
  })
  return {
    spaces: expanded.spaces,
    nodes: nextNodes.map(node => {
      const position = expanded.nodePositionById.get(node.id)
      return position ? { ...node, position } : node
    }),
  }
}

/** Plan with visible bounds; commit positions only, never compact runtime sizes. */
export function planNodeExpansion(
  nodeId: string,
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  state: CanvasCollapseState,
  behavior: NodeExpandBehavior,
): ExpansionPlan | null {
  const target = nodes.find(node => node.id === nodeId)
  if (!target) {
    return null
  }
  const nextState = revealCollapsedNode(state, nodeId, spaces)
  if (!state.collapsedNodeIds[nodeId]) {
    return { nodes, spaces, state: nextState }
  }
  const interactionState = { ...nextState, collapsedNodeIds: state.collapsedNodeIds }
  const view = projectCanvasInteractionLayout(nodes, spaces, interactionState)
  const expanded =
    behavior === 'find-space'
      ? findExpansionSpace(target, view.nodes, view.spaces)
      : resolveWorkspaceLayoutAfterNodeResize({
          nodeId,
          desiredFrame: { position: target.position, size: target.data },
          nodes: view.nodes,
          spaces: view.spaces,
          gap: 0,
        })
  if (!expanded) {
    return behavior === 'find-space' ? null : { nodes, spaces, state: nextState }
  }
  const restored = restoreCanvasInteractionLayout(
    {
      nextSpaces: expanded.spaces,
      nextNodePositionById: new Map(expanded.nodes.map(node => [node.id, node.position])),
    },
    nodes,
    spaces,
    interactionState,
  )
  return {
    state: nextState,
    spaces: restored.nextSpaces,
    nodes: nodes.map(node => {
      const position = restored.nextNodePositionById.get(node.id)
      return position && (position.x !== node.position.x || position.y !== node.position.y)
        ? { ...node, position }
        : node
    }),
  }
}
