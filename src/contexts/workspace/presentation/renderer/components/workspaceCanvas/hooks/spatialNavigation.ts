export type SpatialNavigationDirection = 'left' | 'right' | 'up' | 'down'

export interface SpatialRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface SpatialCandidate {
  id: string
  rect: SpatialRect
}

function isCandidate(
  source: SpatialRect,
  destination: SpatialRect,
  direction: SpatialNavigationDirection,
): boolean {
  switch (direction) {
    case 'left':
      return (
        (source.right > destination.right || source.left >= destination.right) &&
        source.left > destination.left
      )
    case 'right':
      return (
        (source.left < destination.left || source.right <= destination.left) &&
        source.right < destination.right
      )
    case 'up':
      return (
        (source.bottom > destination.bottom || source.top >= destination.bottom) &&
        source.top > destination.top
      )
    case 'down':
      return (
        (source.top < destination.top || source.bottom <= destination.top) &&
        source.bottom < destination.bottom
      )
    default: {
      const _exhaustive: never = direction
      return _exhaustive
    }
  }
}

function beamsOverlap(
  direction: SpatialNavigationDirection,
  source: SpatialRect,
  destination: SpatialRect,
): boolean {
  switch (direction) {
    case 'left':
    case 'right':
      return destination.bottom > source.top && destination.top < source.bottom
    case 'up':
    case 'down':
      return destination.right > source.left && destination.left < source.right
    default: {
      const _exhaustive: never = direction
      return _exhaustive
    }
  }
}

function isToDirectionOf(
  direction: SpatialNavigationDirection,
  source: SpatialRect,
  destination: SpatialRect,
): boolean {
  switch (direction) {
    case 'left':
      return source.left >= destination.right
    case 'right':
      return source.right <= destination.left
    case 'up':
      return source.top >= destination.bottom
    case 'down':
      return source.bottom <= destination.top
    default: {
      const _exhaustive: never = direction
      return _exhaustive
    }
  }
}

function majorAxisDistanceRaw(
  direction: SpatialNavigationDirection,
  source: SpatialRect,
  destination: SpatialRect,
): number {
  switch (direction) {
    case 'left':
      return source.left - destination.right
    case 'right':
      return destination.left - source.right
    case 'up':
      return source.top - destination.bottom
    case 'down':
      return destination.top - source.bottom
    default: {
      const _exhaustive: never = direction
      return _exhaustive
    }
  }
}

function majorAxisDistance(
  direction: SpatialNavigationDirection,
  source: SpatialRect,
  destination: SpatialRect,
): number {
  return Math.max(0, majorAxisDistanceRaw(direction, source, destination))
}

function majorAxisDistanceToFarEdgeRaw(
  direction: SpatialNavigationDirection,
  source: SpatialRect,
  destination: SpatialRect,
): number {
  switch (direction) {
    case 'left':
      return source.left - destination.left
    case 'right':
      return destination.right - source.right
    case 'up':
      return source.top - destination.top
    case 'down':
      return destination.bottom - source.bottom
    default: {
      const _exhaustive: never = direction
      return _exhaustive
    }
  }
}

function majorAxisDistanceToFarEdge(
  direction: SpatialNavigationDirection,
  source: SpatialRect,
  destination: SpatialRect,
): number {
  return Math.max(1, majorAxisDistanceToFarEdgeRaw(direction, source, destination))
}

function minorAxisDistance(
  direction: SpatialNavigationDirection,
  source: SpatialRect,
  destination: SpatialRect,
): number {
  const sourceWidth = source.right - source.left
  const sourceHeight = source.bottom - source.top
  const destinationWidth = destination.right - destination.left
  const destinationHeight = destination.bottom - destination.top

  switch (direction) {
    case 'left':
    case 'right': {
      const sourceCenterY = source.top + sourceHeight / 2
      const destinationCenterY = destination.top + destinationHeight / 2
      return Math.abs(sourceCenterY - destinationCenterY)
    }
    case 'up':
    case 'down': {
      const sourceCenterX = source.left + sourceWidth / 2
      const destinationCenterX = destination.left + destinationWidth / 2
      return Math.abs(sourceCenterX - destinationCenterX)
    }
    default: {
      const _exhaustive: never = direction
      return _exhaustive
    }
  }
}

function getWeightedDistanceFor(majorAxis: number, minorAxis: number): number {
  return 13 * majorAxis * majorAxis + minorAxis * minorAxis
}

function beamBeats(
  direction: SpatialNavigationDirection,
  source: SpatialRect,
  rect1: SpatialRect,
  rect2: SpatialRect,
): boolean {
  const rect1InBeam = beamsOverlap(direction, source, rect1)
  const rect2InBeam = beamsOverlap(direction, source, rect2)

  if (rect2InBeam || !rect1InBeam) {
    return false
  }

  if (!isToDirectionOf(direction, source, rect2)) {
    return true
  }

  if (direction === 'left' || direction === 'right') {
    return true
  }

  return majorAxisDistance(direction, source, rect1) < majorAxisDistanceToFarEdge(direction, source, rect2)
}

function isBetterCandidate(
  direction: SpatialNavigationDirection,
  source: SpatialRect,
  rect1: SpatialRect,
  rect2: SpatialRect,
): boolean {
  if (!isCandidate(source, rect1, direction)) {
    return false
  }

  if (!isCandidate(source, rect2, direction)) {
    return true
  }

  if (beamBeats(direction, source, rect1, rect2)) {
    return true
  }

  if (beamBeats(direction, source, rect2, rect1)) {
    return false
  }

  return (
    getWeightedDistanceFor(
      majorAxisDistance(direction, source, rect1),
      minorAxisDistance(direction, source, rect1),
    ) <
    getWeightedDistanceFor(
      majorAxisDistance(direction, source, rect2),
      minorAxisDistance(direction, source, rect2),
    )
  )
}

export function resolveSpatialNavigationTargetId({
  direction,
  source,
  candidates,
}: {
  direction: SpatialNavigationDirection
  source: SpatialRect
  candidates: SpatialCandidate[]
}): string | null {
  let best: SpatialCandidate | null = null

  for (const candidate of candidates) {
    if (!isCandidate(source, candidate.rect, direction)) {
      continue
    }

    if (!best || isBetterCandidate(direction, source, candidate.rect, best.rect)) {
      best = candidate
    }
  }

  return best?.id ?? null
}

