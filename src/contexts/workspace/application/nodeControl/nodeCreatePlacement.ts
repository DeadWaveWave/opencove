import type { CreateNodeInput, ManagedCanvasNodeKind } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { NodeControlNode, NodeControlSpace, NodeControlWorkspace } from './nodeControlState'
import {
  resolveCanonicalNodeSize,
  type WorkspaceCanonicalSizeBucket,
} from '../../domain/workspaceNodeSizing'
import { computeSpaceRectFromNodes, SPACE_NODE_PADDING } from '../../domain/workspaceSpaceLayout'
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

    const rect = expandSpaceRect(space.rect, nodeRect)
    return { ...space, nodeIds: [...filtered, node.id], rect }
  })

  return {
    ...workspace,
    nodes: [...workspace.nodes, node],
    spaces: nextSpaces,
  }
}

function expandSpaceRect(
  current: NodeControlSpace['rect'],
  node: { x: number; y: number; width: number; height: number },
): NodeControlSpace['rect'] {
  if (!current) {
    return computeSpaceRectFromNodes([node])
  }

  const left = Math.min(current.x, node.x - SPACE_NODE_PADDING)
  const top = Math.min(current.y, node.y - SPACE_NODE_PADDING)
  const right = Math.max(current.x + current.width, node.x + node.width + SPACE_NODE_PADDING)
  const bottom = Math.max(current.y + current.height, node.y + node.height + SPACE_NODE_PADDING)

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
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

export function resolvePlacement(options: {
  workspace: NodeControlWorkspace
  space: NodeControlSpace | null
  kind: ManagedCanvasNodeKind
  bucket: WorkspaceCanonicalSizeBucket
  frame?: CreateNodeInput['frame']
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
  const anchor = targetSpaceRect
    ? { x: targetSpaceRect.x + SPACE_NODE_PADDING, y: targetSpaceRect.y + SPACE_NODE_PADDING }
    : { x: 0, y: 0 }
  const spaceRects = options.workspace.spaces
    .map(space => space.rect)
    .filter((rect): rect is { x: number; y: number; width: number; height: number } =>
      Boolean(rect),
    )
  const resolved = resolveWorkspaceNodesPlacement({
    anchor,
    size: defaultSize,
    nodes: options.workspace.nodes.map(node => ({
      id: node.id,
      position: node.position,
      data: { width: node.width, height: node.height },
    })),
    spaceRects,
    targetSpaceRect,
  })

  if (!resolved.canPlace) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create could not find an available canvas slot.',
    })
  }

  return { placement: resolved.placement, size: defaultSize }
}
