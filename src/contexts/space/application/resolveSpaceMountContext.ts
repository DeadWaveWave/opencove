import type { MountDto } from '@shared/contracts/dto'

export interface SpaceMountContextLike {
  directoryPath: string
  targetMountId?: string | null
}

export interface ResolvedSpaceMountContext {
  mount: MountDto | null
  workingDirectory: string
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
  const normalizedRoot = normalizeComparablePath(rootPath)
  const normalizedTarget = normalizeComparablePath(targetPath)

  if (normalizedRoot.length === 0 || normalizedTarget.length === 0) {
    return false
  }

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
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
      repair: null,
    }
  }

  const directoryWithinMount =
    rawDirectoryPath !== null && isPathInside(fallbackMount.rootPath, rawDirectoryPath)
  const workingDirectory = directoryWithinMount ? rawDirectoryPath : fallbackMount.rootPath

  const shouldRepairTargetMountId = currentTargetMountId !== fallbackMount.mountId
  const shouldRepairDirectoryPath =
    rawDirectoryPath === null ||
    (!directoryWithinMount && rawDirectoryPath !== fallbackMount.rootPath)

  return {
    mount: fallbackMount,
    workingDirectory,
    repair:
      options.space && (shouldRepairTargetMountId || shouldRepairDirectoryPath)
        ? {
            targetMountId: fallbackMount.mountId,
            directoryPath: workingDirectory,
          }
        : null,
  }
}
