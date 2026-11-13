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
import { nodeNearSpaceRects } from './nodeNearSpaceRects'
import { resolveWorkspaceNodesPlacement } from '../../domain/workspaceNodePlacement'

export function workspaceWithNode(
  workspace: NodeControlWorkspace,
  node: NodeControlNode,
  spaceId: string | null,
  near = false,
): NodeControlWorkspace {
  const nodeRect = {
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
  }

  const effectiveRects = near ? nodeNearSpaceRects(workspace) : null
  const branch = new Set<string>()
  let current = near ? spaceId : null
  while (current && !branch.has(current)) {
    branch.add(current)
    current = workspace.spaces.find(space => space.id === current)?.parentSpaceId ?? null
  }
  const nextSpaces = workspace.spaces.map(original => {
    const space =
      near && branch.has(original.id) && !original.rect
        ? { ...original, rect: effectiveRects!.get(original.id) ?? null }
        : original
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
function rootCreationAnchor(
  workspace: NodeControlWorkspace,
  callerNodeId?: string | null,
  effectiveRects?: ReturnType<typeof nodeNearSpaceRects> | null,
) {
  const caller = callerNodeId ? workspace.nodes.find(node => node.id === callerNodeId) : undefined
  if (!caller) {
    return { x: 0, y: 0 }
  }
  const space = workspace.spaces.find(candidate => candidate.nodeIds.includes(caller.id))
  const rect = space ? (effectiveRects?.get(space.id) ?? resolveSpaceRect(workspace, space)) : null
  return {
    x: (rect ? rect.x + rect.width : caller.position.x + caller.width) + SPACE_NODE_PADDING,
    y: caller.position.y,
  }
}

/** Candidate anchors only; the shared solver owns collision checks and fallback. */
function nearCreationAnchors(
  reference: NodeControlNode,
  size: { width: number; height: number },
  nodes: NodeControlNode[],
) {
  const { x, y } = reference.position
  const right = x + reference.width,
    bottom = y + reference.height
  const ys = [
    ...new Set([y, ...nodes.map(node => node.position.y + node.height + SPACE_NODE_PADDING)]),
  ].filter(value => value >= y)
  const xs = [
    ...new Set([
      x,
      right - size.width,
      ...nodes.flatMap(node => [
        node.position.x + node.width + SPACE_NODE_PADDING,
        node.position.x - size.width - SPACE_NODE_PADDING,
      ]),
    ]),
  ]
  const candidates = [
    ...ys.map(top => ({ x: right + SPACE_NODE_PADDING, y: top, side: 0, offset: top - y })),
    ...xs.map(left => ({
      x: left,
      y: bottom + SPACE_NODE_PADDING,
      side: 1,
      offset: Math.abs(left - x),
    })),
    ...ys.map(top => ({
      x: x - size.width - SPACE_NODE_PADDING,
      y: top,
      side: 2,
      offset: top - y,
    })),
  ].map(point => ({
    ...point,
    distance: Math.hypot(
      Math.max(x - point.x - size.width, point.x - right, 0),
      Math.max(y - point.y - size.height, point.y - bottom, 0),
    ),
  }))
  return candidates
    .sort((a, b) => a.distance - b.distance || a.side - b.side || a.offset - b.offset)
    .map(point => ({ x: point.x, y: point.y }))
}

export function resolvePlacement(options: {
  workspace: NodeControlWorkspace
  space: NodeControlSpace | null
  kind: ManagedCanvasNodeKind
  bucket: WorkspaceCanonicalSizeBucket
  frame?: CreateNodeInput['frame']
  callerNodeId?: string | null
  reference?: NodeControlNode
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

  const effectiveRects = options.reference ? nodeNearSpaceRects(options.workspace) : null
  const targetSpaceRect = options.space
    ? (effectiveRects?.get(options.space.id) ?? resolveSpaceRect(options.workspace, options.space))
    : null
  const automaticRoot = !options.space && explicitX === null && explicitY === null
  const rootAnchor = automaticRoot
    ? rootCreationAnchor(
        options.workspace,
        options.reference?.id ?? options.callerNodeId,
        effectiveRects,
      )
    : { x: 0, y: 0 }
  const size = automaticRoot
    ? clampFrameSize({
        kind: options.kind,
        width: options.frame?.width ?? defaultSize.width,
        height: options.frame?.height ?? defaultSize.height,
      })
    : defaultSize
  const anchor =
    options.reference && options.space
      ? {
          x: options.reference.position.x + options.reference.width + SPACE_NODE_PADDING,
          y: options.reference.position.y,
        }
      : targetSpaceRect
        ? { x: targetSpaceRect.x + SPACE_NODE_PADDING, y: targetSpaceRect.y + SPACE_NODE_PADDING }
        : rootAnchor
  const spaceRects = options.workspace.spaces
    .map(space => effectiveRects?.get(space.id) ?? space.rect)
    .filter((rect): rect is { x: number; y: number; width: number; height: number } =>
      Boolean(rect),
    )
  const resolved = resolveWorkspaceNodesPlacement({
    anchor,
    preferredAnchors:
      options.reference &&
      (options.space ||
        !options.workspace.spaces.some(space => space.nodeIds.includes(options.reference!.id)))
        ? nearCreationAnchors(options.reference, size, options.workspace.nodes)
        : undefined,
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
