import type { SpaceBoundary } from '../types/spaceBoundary'

export function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

export function areNullableStringArraysEqual(
  left: readonly string[] | null,
  right: readonly string[] | null,
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }

  return areStringArraysEqual(left, right)
}

export function isSpaceBoundaryEqual(
  left: SpaceBoundary | null | undefined,
  right: SpaceBoundary | null | undefined,
): boolean {
  const leftBoundary = left ?? null
  const rightBoundary = right ?? null
  if (leftBoundary === rightBoundary) {
    return true
  }
  if (!leftBoundary || !rightBoundary) {
    return false
  }
  if (
    leftBoundary.trustLevel !== rightBoundary.trustLevel ||
    !areStringArraysEqual(leftBoundary.allowedMountIds, rightBoundary.allowedMountIds) ||
    !areNullableStringArraysEqual(leftBoundary.allowedPluginIds, rightBoundary.allowedPluginIds) ||
    !areNullableStringArraysEqual(leftBoundary.capabilities, rightBoundary.capabilities)
  ) {
    return false
  }

  const leftScopeKeys = Object.keys(leftBoundary.scopesByMountId).sort()
  const rightScopeKeys = Object.keys(rightBoundary.scopesByMountId).sort()
  if (!areStringArraysEqual(leftScopeKeys, rightScopeKeys)) {
    return false
  }

  return leftScopeKeys.every(key => {
    const leftScope = leftBoundary.scopesByMountId[key]
    const rightScope = rightBoundary.scopesByMountId[key]
    return (
      leftScope?.rootPath === rightScope?.rootPath && leftScope?.rootUri === rightScope?.rootUri
    )
  })
}
