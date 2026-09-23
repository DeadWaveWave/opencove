import type { WorkspaceSpaceRect, WorkspaceSpaceState } from '../types'
import { pushAwayLayout, type LayoutDirection, type LayoutItem } from './spaceLayout'

/** Push peer regions before measuring the next ancestor; move each sibling subtree as one unit. */
export function pushExpandedSpacePeers({
  spaceId,
  spaces,
  spaceRectById,
  nodeRectById,
  owningSpaceIdByNodeId,
  directChildSpaceIdsByParentId,
  changedSpaceIds,
  directions,
  gap,
}: {
  spaceId: string
  spaces: WorkspaceSpaceState[]
  spaceRectById: Map<string, WorkspaceSpaceRect>
  nodeRectById: Map<string, WorkspaceSpaceRect>
  owningSpaceIdByNodeId: Map<string, string>
  directChildSpaceIdsByParentId: Map<string, string[]>
  changedSpaceIds: Set<string>
  directions: LayoutDirection[]
  gap: number
}): void {
  const parentId = spaces.find(space => space.id === spaceId)?.parentSpaceId
  if (!parentId) {
    return
  }
  const siblings = new Set(directChildSpaceIdsByParentId.get(parentId) ?? [])
  const items: LayoutItem[] = [...siblings].flatMap(id => {
    const rect = spaceRectById.get(id)
    return rect ? [{ id, kind: 'space' as const, groupId: `space:${id}`, rect }] : []
  })
  for (const [id, rect] of nodeRectById) {
    const ownerId = owningSpaceIdByNodeId.get(id)
    if (!ownerId || ownerId === parentId) {
      items.push({ id, kind: 'node', groupId: `node:${id}`, rect })
    }
  }
  const pushed = pushAwayLayout({
    items,
    pinnedGroupIds: [`space:${spaceId}`],
    sourceGroupIds: [`space:${spaceId}`],
    directions,
    gap,
  })
  const movedSpaceDeltas = new Map<string, { x: number; y: number }>()
  for (const item of pushed) {
    if (item.kind === 'node') {
      nodeRectById.set(item.id, item.rect)
      continue
    }
    const before = spaceRectById.get(item.id)
    if (before && (before.x !== item.rect.x || before.y !== item.rect.y)) {
      movedSpaceDeltas.set(item.id, { x: item.rect.x - before.x, y: item.rect.y - before.y })
    }
  }
  for (const [movedId, delta] of movedSpaceDeltas) {
    const subtreeIds = new Set<string>()
    const queue = [movedId]
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index]
      if (subtreeIds.has(id)) {
        continue
      }
      subtreeIds.add(id)
      queue.push(...(directChildSpaceIdsByParentId.get(id) ?? []))
    }
    for (const id of subtreeIds) {
      const rect = spaceRectById.get(id)
      if (rect) {
        spaceRectById.set(id, { ...rect, x: rect.x + delta.x, y: rect.y + delta.y })
        changedSpaceIds.add(id)
      }
    }
    for (const [id, rect] of nodeRectById) {
      if (subtreeIds.has(owningSpaceIdByNodeId.get(id) ?? '')) {
        nodeRectById.set(id, { ...rect, x: rect.x + delta.x, y: rect.y + delta.y })
      }
    }
  }
}
