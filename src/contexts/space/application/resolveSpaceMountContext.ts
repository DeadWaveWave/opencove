import type { MountDto } from '@shared/contracts/dto'
import type { SpaceBoundary } from '@shared/types/spaceBoundary'
import { isPathInsideOrEqual, resolveSpaceBoundaryScope } from './spaceBoundaryPolicy'

export interface SpaceMountContextLike {
  directoryPath: string
  targetMountId?: string | null
  boundary?: SpaceBoundary | null
}

export interface ResolvedSpaceMountContext {
  mount: MountDto | null
  workingDirectory: string
  scope: {
    rootPath: string
    rootUri: string
  } | null
  repair: {
    targetMountId: string | null
    directoryPath: string
  } | null
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeComparablePath(pathValue: string): string {
  const normalized = pathValue
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  return isPathInsideOrEqual(rootPath, targetPath)
}

function resolveBestMount(mounts: MountDto[], directoryPath: string): MountDto | null {
  const normalizedDirectoryPath = normalizeComparablePath(directoryPath)
  if (normalizedDirectoryPath.length === 0) {
    return mounts[0] ?? null
  }

  const matches = mounts
    .filter(mount => isPathInside(mount.rootPath, normalizedDirectoryPath))
    .sort(
      (left, right) =>
        normalizeComparablePath(right.rootPath).length -
        normalizeComparablePath(left.rootPath).length,
    )

  return matches[0] ?? null
}

export function resolveSpaceMountContext(options: {
  space: SpaceMountContextLike | null
  workspacePath: string
  mounts: MountDto[]
  fallbackToFirstMount?: boolean
}): ResolvedSpaceMountContext {
  const mounts = Array.isArray(options.mounts) ? options.mounts : []
  const rawDirectoryPath = normalizeOptionalString(options.space?.directoryPath)
  const fallbackDirectory = rawDirectoryPath ?? options.workspacePath
  const currentTargetMountId = normalizeOptionalString(options.space?.targetMountId)
  const mountById =
    currentTargetMountId !== null
      ? (mounts.find(mount => mount.mountId === currentTargetMountId) ?? null)
      : null
  const inferredMount =
    rawDirectoryPath && (currentTargetMountId === null || mountById === null)
      ? resolveBestMount(mounts, rawDirectoryPath)
      : null
  const fallbackMount =
    mountById ??
    inferredMount ??
    (options.fallbackToFirstMount === true ? (mounts[0] ?? null) : null)

  if (!fallbackMount) {
    return {
      mount: null,
      workingDirectory: fallbackDirectory,
      scope: null,
      repair: null,
    }
  }

  const boundaryScope = resolveSpaceBoundaryScope(options.space?.boundary, fallbackMount.mountId)
  const isBoundaryScopeWithinMount =
    boundaryScope !== null && isPathInside(fallbackMount.rootPath, boundaryScope.rootPath)
  const directoryWithinMount =
    rawDirectoryPath !== null && isPathInside(fallbackMount.rootPath, rawDirectoryPath)
  const workingDirectory = isBoundaryScopeWithinMount
    ? boundaryScope.rootPath
    : directoryWithinMount
      ? rawDirectoryPath
      : fallbackMount.rootPath
  const scope = isBoundaryScopeWithinMount
    ? {
        rootPath: boundaryScope.rootPath,
        rootUri:
          boundaryScope.rootUri.trim().length > 0 ? boundaryScope.rootUri : fallbackMount.rootUri,
      }
    : {
        rootPath: fallbackMount.rootPath,
        rootUri: fallbackMount.rootUri,
      }

  const shouldRepairTargetMountId = currentTargetMountId !== fallbackMount.mountId
  const shouldRepairDirectoryPath =
    rawDirectoryPath === null || rawDirectoryPath !== workingDirectory

  return {
    mount: fallbackMount,
    workingDirectory,
    scope,
    repair:
      options.space && (shouldRepairTargetMountId || shouldRepairDirectoryPath)
        ? {
            targetMountId: fallbackMount.mountId,
            directoryPath: workingDirectory,
          }
        : null,
  }
}
