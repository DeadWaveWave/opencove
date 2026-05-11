import { toFileUri } from '../../filesystem/domain/fileUri'
import {
  createMountOnlySpaceBoundary,
  isSpaceBoundaryEmpty,
  normalizeSpaceBoundary,
  type SpaceBoundary,
  type SpaceBoundaryScope,
} from '../../../shared/types/spaceBoundary'

export interface SpaceBoundaryRecord {
  directoryPath: string
  targetMountId?: string | null
  boundary?: SpaceBoundary | null
}

export function normalizeComparablePath(pathValue: string): string {
  const normalized = pathValue
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')

  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}

export function isPathInsideOrEqual(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizeComparablePath(rootPath)
  const normalizedTarget = normalizeComparablePath(targetPath)

  if (normalizedRoot.length === 0 || normalizedTarget.length === 0) {
    return false
  }

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

export function resolveSpaceBoundaryScope(
  boundary: SpaceBoundary | null | undefined,
  mountId: string | null | undefined,
): SpaceBoundaryScope | null {
  const normalizedMountId = typeof mountId === 'string' ? mountId.trim() : ''
  if (normalizedMountId.length === 0) {
    return null
  }

  const normalizedBoundary = normalizeSpaceBoundary(boundary)
  if (!normalizedBoundary.allowedMountIds.includes(normalizedMountId)) {
    return null
  }

  const scope = normalizedBoundary.scopesByMountId[normalizedMountId]
  return scope && scope.rootPath.trim().length > 0 ? scope : null
}

export function createBoundaryFromSpaceProjection(space: SpaceBoundaryRecord): SpaceBoundary {
  const normalizedBoundary = normalizeSpaceBoundary(space.boundary)
  if (!isSpaceBoundaryEmpty(normalizedBoundary)) {
    return normalizedBoundary
  }

  const targetMountId = typeof space.targetMountId === 'string' ? space.targetMountId.trim() : ''
  const rootPath = space.directoryPath.trim()
  if (!targetMountId || !rootPath) {
    return normalizedBoundary
  }

  return createMountOnlySpaceBoundary({
    mountId: targetMountId,
    rootPath,
    rootUri: toFileUri(rootPath),
  })
}

export function deriveDirectoryPathFromBoundary(
  space: SpaceBoundaryRecord,
  fallbackPath: string,
): string {
  const scope = resolveSpaceBoundaryScope(space.boundary, space.targetMountId)
  if (scope) {
    return scope.rootPath
  }

  const directoryPath = space.directoryPath.trim()
  return directoryPath.length > 0 ? directoryPath : fallbackPath
}

export function replaceBoundaryScopeRoot(options: {
  boundary: SpaceBoundary | null | undefined
  mountId: string | null | undefined
  rootPath: string
}): SpaceBoundary {
  const normalizedBoundary = normalizeSpaceBoundary(options.boundary)
  const mountId = typeof options.mountId === 'string' ? options.mountId.trim() : ''
  const rootPath = options.rootPath.trim()
  if (!mountId || !rootPath || !normalizedBoundary.allowedMountIds.includes(mountId)) {
    return normalizedBoundary
  }

  return {
    ...normalizedBoundary,
    scopesByMountId: {
      ...normalizedBoundary.scopesByMountId,
      [mountId]: {
        rootPath,
        rootUri: toFileUri(rootPath),
      },
    },
  }
}
