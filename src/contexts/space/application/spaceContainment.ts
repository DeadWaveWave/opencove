export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

export interface SpaceContainmentLike {
  id: string
  parentSpaceId?: string | null
  rect?: RectLike | null
}

export function isPointInsideRect(point: { x: number; y: number }, rect: RectLike): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

export function isRectInsideRect(rect: RectLike, container: RectLike): boolean {
  return (
    rect.x >= container.x &&
    rect.y >= container.y &&
    rect.x + rect.width <= container.x + container.width &&
    rect.y + rect.height <= container.y + container.height
  )
}

export function clampRectInsideRect(rect: RectLike, container: RectLike, padding = 12): RectLike {
  const maxWidth = Math.max(1, container.width - padding * 2)
  const maxHeight = Math.max(1, container.height - padding * 2)
  const width = Math.min(rect.width, maxWidth)
  const height = Math.min(rect.height, maxHeight)
  const minX = container.x + padding
  const minY = container.y + padding
  const maxX = container.x + container.width - padding - width
  const maxY = container.y + container.height - padding - height

  return {
    x: Math.min(Math.max(rect.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(rect.y, minY), Math.max(minY, maxY)),
    width,
    height,
  }
}

export function resolveInnermostSpaceAtPoint<TSpace extends SpaceContainmentLike>(
  spaces: TSpace[],
  point: { x: number; y: number },
): TSpace | null {
  const spaceById = new Map(spaces.map(space => [space.id, space] as const))

  function resolveDepth(space: TSpace, visited = new Set<string>()): number {
    const parentId = space.parentSpaceId ?? null
    if (!parentId || visited.has(space.id)) {
      return 0
    }

    const parent = spaceById.get(parentId)
    if (!parent) {
      return 0
    }

    visited.add(space.id)
    return 1 + resolveDepth(parent, visited)
  }

  const candidates = spaces.filter(space => space.rect && isPointInsideRect(point, space.rect))
  if (candidates.length === 0) {
    return null
  }

  return candidates.sort((left, right) => {
    const depthDifference = resolveDepth(right) - resolveDepth(left)
    if (depthDifference !== 0) {
      return depthDifference
    }

    const leftArea = left.rect ? left.rect.width * left.rect.height : Number.POSITIVE_INFINITY
    const rightArea = right.rect ? right.rect.width * right.rect.height : Number.POSITIVE_INFINITY
    return leftArea - rightArea
  })[0]
}
