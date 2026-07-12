import type { WorkspaceSpaceRect } from '../../../types'
import {
  pushAwayLayout,
  SPACE_NODE_PADDING,
  type LayoutDirection,
  type LayoutItem,
} from '../../../utils/spaceLayout'

const LAYOUT_EPSILON = 0.001

function rectsIntersect(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  return !(
    a.x + a.width <= b.x + LAYOUT_EPSILON ||
    a.x >= b.x + b.width - LAYOUT_EPSILON ||
    a.y + a.height <= b.y + LAYOUT_EPSILON ||
    a.y >= b.y + b.height - LAYOUT_EPSILON
  )
}

function rectFitsInside(
  rect: WorkspaceSpaceRect,
  bounds: WorkspaceSpaceRect,
  padding: number,
): boolean {
  return (
    rect.x >= bounds.x + padding - LAYOUT_EPSILON &&
    rect.y >= bounds.y + padding - LAYOUT_EPSILON &&
    rect.x + rect.width <= bounds.x + bounds.width - padding + LAYOUT_EPSILON &&
    rect.y + rect.height <= bounds.y + bounds.height - padding + LAYOUT_EPSILON
  )
}

function passesBoundedCapacityLowerBound({
  items,
  targetSpaceRect,
  padding,
}: {
  items: LayoutItem[]
  targetSpaceRect: WorkspaceSpaceRect
  padding: number
}): boolean {
  const innerWidth = Math.max(0, targetSpaceRect.width - padding * 2)
  const innerHeight = Math.max(0, targetSpaceRect.height - padding * 2)
  const innerArea = innerWidth * innerHeight
  let requiredArea = 0

  for (const item of items) {
    if (item.rect.width > innerWidth || item.rect.height > innerHeight) {
      return false
    }

    requiredArea += Math.max(0, item.rect.width) * Math.max(0, item.rect.height)
    if (requiredArea > innerArea + LAYOUT_EPSILON) {
      return false
    }
  }

  return true
}

function isValidBoundedLayout({
  items,
  targetSpaceRect,
  padding,
}: {
  items: LayoutItem[]
  targetSpaceRect: WorkspaceSpaceRect
  padding: number
}): boolean {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || !rectFitsInside(item.rect, targetSpaceRect, padding)) {
      return false
    }

    for (let peerIndex = index + 1; peerIndex < items.length; peerIndex += 1) {
      const peer = items[peerIndex]
      if (!peer || item.groupId === peer.groupId) {
        continue
      }

      if (rectsIntersect(item.rect, peer.rect)) {
        return false
      }
    }
  }

  return true
}

export function resolveLiveTargetSpaceLayout({
  items,
  pinnedGroupIds,
  sourceGroupIds,
  directions,
  targetSpaceRect,
  padding = SPACE_NODE_PADDING,
}: {
  items: LayoutItem[]
  pinnedGroupIds: string[]
  sourceGroupIds: string[]
  directions: LayoutDirection[]
  targetSpaceRect: WorkspaceSpaceRect
  padding?: number
}): LayoutItem[] {
  // This is only a necessary capacity check. The postcondition below still
  // decides whether the bounded rectangle packing actually succeeded.
  if (passesBoundedCapacityLowerBound({ items, targetSpaceRect, padding })) {
    const bounded = pushAwayLayout({
      items,
      pinnedGroupIds,
      sourceGroupIds,
      directions,
      gap: 0,
      bounds: { rect: targetSpaceRect, padding },
    })

    if (isValidBoundedLayout({ items: bounded, targetSpaceRect, padding })) {
      return bounded
    }
  }

  // Overflow is intentional here: the derived Space frame expands around this
  // layout on the same secondary projection, before any durable state changes.
  return pushAwayLayout({
    items,
    pinnedGroupIds,
    sourceGroupIds,
    directions,
    gap: 0,
  })
}
