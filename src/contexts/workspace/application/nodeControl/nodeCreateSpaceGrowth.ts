import type { RectLike } from '../../../space/application/spaceContainment'
import {
  expandRectToContain,
  growSpaceAncestors,
} from '../../../space/application/spaceGeometryGrowth'
import { computeSpaceRectFromNodes, SPACE_NODE_PADDING } from '../../domain/workspaceSpaceLayout'
import type { NodeControlWorkspace } from './nodeControlState'
import type { nodeNearSpaceRects } from './nodeNearSpaceRects'

/** One pure growth plan, shared by candidate ranking and the creation CAS insertion. */
export function growNodeCreationSpaces(
  workspace: NodeControlWorkspace,
  spaceId: string,
  nodeRect: RectLike,
  effectiveRects?: ReturnType<typeof nodeNearSpaceRects> | null,
) {
  const branch = new Set<string>()
  let current: string | null = effectiveRects ? spaceId : null
  while (current && !branch.has(current)) {
    branch.add(current)
    current = workspace.spaces.find(space => space.id === current)?.parentSpaceId ?? null
  }
  const spaces = workspace.spaces.map(original => {
    const space =
      effectiveRects && branch.has(original.id) && !original.rect
        ? { ...original, rect: effectiveRects.get(original.id) ?? null }
        : original
    if (space.id !== spaceId) {
      return space
    }
    return {
      ...space,
      rect: space.rect
        ? expandRectToContain(space.rect, nodeRect, SPACE_NODE_PADDING)
        : computeSpaceRectFromNodes([nodeRect]),
    }
  })
  return growSpaceAncestors(spaces, spaceId, SPACE_NODE_PADDING)
}

/** Tiers: unchanged geometry, safe growth, growth intersecting unrelated Spaces. */
export function nearGrowthRanker(
  workspace: NodeControlWorkspace,
  spaceId: string,
  effectiveRects: ReturnType<typeof nodeNearSpaceRects>,
) {
  const byId = new Map(workspace.spaces.map(space => [space.id, space]))
  const ancestors = new Map<string, Set<string>>()
  for (const space of workspace.spaces) {
    const ids = new Set<string>([space.id])
    let current = space.parentSpaceId
    while (current && !ids.has(current)) {
      ids.add(current)
      current = byId.get(current)?.parentSpaceId
    }
    ancestors.set(space.id, ids)
  }
  return (rect: RectLike): number => {
    const grown = growNodeCreationSpaces(workspace, spaceId, rect, effectiveRects)
    let changed = false
    for (const space of grown) {
      const before = byId.get(space.id)!.rect,
        after = space.rect
      if (
        !after ||
        (before &&
          before.x === after.x &&
          before.y === after.y &&
          before.width === after.width &&
          before.height === after.height)
      ) {
        continue
      }
      changed = true
      for (const other of workspace.spaces) {
        if (ancestors.get(space.id)!.has(other.id) || ancestors.get(other.id)!.has(space.id)) {
          continue
        }
        const obstacle = effectiveRects.get(other.id)
        if (
          obstacle &&
          after.x < obstacle.x + obstacle.width &&
          after.x + after.width > obstacle.x &&
          after.y < obstacle.y + obstacle.height &&
          after.y + after.height > obstacle.y
        ) {
          return 2
        }
      }
    }
    return changed ? 1 : 0
  }
}
