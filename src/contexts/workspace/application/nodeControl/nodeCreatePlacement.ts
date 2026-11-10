import type { CreateNodeInput, ManagedCanvasNodeKind } from '../../../../shared/contracts/dto'
import { clampFrameSize } from './nodeDataFactory'
import { createAppError } from '../../../../shared/errors/appError'
import type { NodeControlNode, NodeControlSpace, NodeControlWorkspace } from './nodeControlState'
import {
  resolveCanonicalNodeSize,
  type WorkspaceCanonicalSizeBucket,
} from '../../domain/workspaceNodeSizing'
import { computeSpaceRectFromNodes, SPACE_NODE_PADDING } from '../../domain/workspaceSpaceLayout'
import {
  expandRectToContain,
  growSpaceAncestors,
} from '../../../space/application/spaceGeometryGrowth'
import { resolveWorkspaceNodesPlacement } from '../../domain/workspaceNodePlacement'

export function workspaceWithNode(
  workspace: NodeControlWorkspace,
  node: NodeControlNode,
  spaceId: string | null,
): NodeControlWorkspace {
  const nodeRect = {
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
  }

  const nextSpaces = workspace.spaces.map(space => {
    const filtered = space.nodeIds.filter(nodeId => nodeId !== node.id)
    if (space.id !== spaceId) {
      return { ...space, nodeIds: filtered }
    }

    const rect = space.rect
      ? expandRectToContain(space.rect, nodeRect, SPACE_NODE_PADDING)
      : computeSpaceRectFromNodes([nodeRect])
    return { ...space, nodeIds: [...filtered, node.id], rect }
  })

  return {
    ...workspace,
    nodes: [...workspace.nodes, node],
    spaces: spaceId ? growSpaceAncestors(nextSpaces, spaceId, SPACE_NODE_PADDING) : nextSpaces,
  }
}

function resolveSpaceRect(
  workspace: NodeControlWorkspace,
  space: NodeControlSpace,
): { x: number; y: number; width: number; height: number } | null {
  if (space.rect) {
    return space.rect
  }

  const nodeById = new Map(workspace.nodes.map(node => [node.id, node]))
  const ownedNodes = space.nodeIds
    .map(nodeId => nodeById.get(nodeId))
    .filter((node): node is NodeControlNode => Boolean(node))
  if (ownedNodes.length === 0) {
    return null
  }

  return computeSpaceRectFromNodes(
    ownedNodes.map(node => ({
      x: node.position.x,
      y: node.position.y,
      width: node.width,
      height: node.height,
    })),
  )
}

/** The boundary supplies only an authenticated caller ID; geometry stays workspace-owned. */
function rootCreationAnchor(workspace: NodeControlWorkspace, callerNodeId?: string | null) {
  const caller = callerNodeId ? workspace.nodes.find(node => node.id === callerNodeId) : undefined
  if (!caller) {
    return { x: 0, y: 0 }
  }
  const space = workspace.spaces.find(candidate => candidate.nodeIds.includes(caller.id))
  const rect = space ? resolveSpaceRect(workspace, space) : null
  return {
    x: (rect ? rect.x + rect.width : caller.position.x + caller.width) + SPACE_NODE_PADDING,
    y: caller.position.y,
  }
}

export function resolvePlacement(options: {
  workspace: NodeControlWorkspace
  space: NodeControlSpace | null
  kind: ManagedCanvasNodeKind
  bucket: WorkspaceCanonicalSizeBucket
  frame?: CreateNodeInput['frame']
  callerNodeId?: string | null
}): { placement: { x: number; y: number }; size: { width: number; height: number } } {
  const defaultSize = resolveCanonicalNodeSize({ kind: options.kind, bucket: options.bucket })
  const explicitX =
    typeof options.frame?.x === 'number' && Number.isFinite(options.frame.x)
      ? options.frame.x
      : null
  const explicitY =
    typeof options.frame?.y === 'number' && Number.isFinite(options.frame.y)
      ? options.frame.y
      : null

  if (explicitX !== null && explicitY !== null) {
    return { placement: { x: explicitX, y: explicitY }, size: defaultSize }
  }

  const targetSpaceRect = options.space ? resolveSpaceRect(options.workspace, options.space) : null
  const automaticRoot = !options.space && explicitX === null && explicitY === null
  const rootAnchor = automaticRoot
    ? rootCreationAnchor(options.workspace, options.callerNodeId)
    : { x: 0, y: 0 }
  const size = automaticRoot
    ? clampFrameSize({
        kind: options.kind,
        width: options.frame?.width ?? defaultSize.width,
        height: options.frame?.height ?? defaultSize.height,
      })
    : defaultSize
  const anchor = targetSpaceRect
    ? { x: targetSpaceRect.x + SPACE_NODE_PADDING, y: targetSpaceRect.y + SPACE_NODE_PADDING }
    : rootAnchor
  const spaceRects = options.workspace.spaces
    .map(space => space.rect)
    .filter((rect): rect is { x: number; y: number; width: number; height: number } =>
      Boolean(rect),
    )
  const resolved = resolveWorkspaceNodesPlacement({
    anchor,
    size,
    nodes: options.workspace.nodes.map(node => ({
      id: node.id,
      position: node.position,
      data: { width: node.width, height: node.height },
    })),
    spaceRects,
    targetSpaceRect,
    overflowDirections: targetSpaceRect ? ['right', 'down', 'left', 'up'] : undefined,
  })

  if (!resolved.canPlace) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create could not find an available canvas slot.',
    })
  }

  return { placement: resolved.placement, size }
}
