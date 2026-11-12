import type { RectLike, SpaceContainmentLike } from './spaceContainment'

/** Preserve the current frame and grow only the edges needed to contain content. */
export function expandRectToContain(
  current: RectLike | null | undefined,
  content: RectLike,
  padding: number,
): RectLike {
  const left = Math.min(current?.x ?? Infinity, content.x - padding)
  const top = Math.min(current?.y ?? Infinity, content.y - padding)
  const right = Math.max(
    current ? current.x + current.width : -Infinity,
    content.x + content.width + padding,
  )
  const bottom = Math.max(
    current ? current.y + current.height : -Infinity,
    content.y + content.height + padding,
  )
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Bottom-up propagation uses each grown child, without changing membership or input records. */
export function growSpaceAncestors<T extends SpaceContainmentLike>(
  spaces: T[],
  spaceId: string,
  padding: number,
): T[] {
  const byId = new Map(spaces.map(space => [space.id, space]))
  const seen = new Set<string>([spaceId])
  let child = byId.get(spaceId)
  while (child?.rect && child.parentSpaceId) {
    const parent = byId.get(child.parentSpaceId)
    if (!parent || seen.has(parent.id)) {
      break
    }
    seen.add(parent.id)
    const grown = { ...parent, rect: expandRectToContain(parent.rect, child.rect, padding) }
    byId.set(parent.id, grown)
    child = grown
  }
  return spaces.map(space => byId.get(space.id)!)
}
