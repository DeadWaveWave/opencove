import { resolveSpaceMountContext } from '@contexts/space/application/resolveSpaceMountContext'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import type { ListMountsResult, MountDto } from '@shared/contracts/dto'
import type { WorkspaceSpaceState } from '../../../types'

function resolveControlSurfaceInvoke():
  | (<TResult>(request: {
      kind: 'query' | 'command'
      id: string
      payload: unknown
    }) => Promise<TResult>)
  | null {
  const controlSurfaceInvoke = (
    window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
  ).opencoveApi?.controlSurface?.invoke

  return typeof controlSurfaceInvoke === 'function'
    ? (controlSurfaceInvoke as <TResult>(request: {
        kind: 'query' | 'command'
        id: string
        payload: unknown
      }) => Promise<TResult>)
    : null
}

export async function listProjectMounts(workspaceId: string): Promise<MountDto[] | null> {
  const normalizedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : ''
  if (normalizedWorkspaceId.length === 0) {
    return null
  }

  const invoke = resolveControlSurfaceInvoke()
  if (!invoke) {
    return null
  }

  const result = await invoke<ListMountsResult>({
    kind: 'query',
    id: 'mount.list',
    payload: { projectId: normalizedWorkspaceId },
  })
  return result.mounts
}

function applySpaceMountRepair(options: {
  space: WorkspaceSpaceState | null
  repair: { targetMountId: string | null; directoryPath: string } | null
  spaces: WorkspaceSpaceState[]
  onSpacesChange?: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
}): WorkspaceSpaceState | null {
  const { space, repair } = options
  if (!space || !repair) {
    return space
  }

  if (
    space.targetMountId === repair.targetMountId &&
    space.directoryPath === repair.directoryPath
  ) {
    return space
  }

  const nextSpaces = options.spaces.map(candidate =>
    candidate.id === space.id
      ? {
          ...candidate,
          targetMountId: repair.targetMountId,
          directoryPath: repair.directoryPath,
        }
      : candidate,
  )
  options.onSpacesChange?.(nextSpaces)
  options.onRequestPersistFlush?.()

  return nextSpaces.find(candidate => candidate.id === space.id) ?? space
}

export async function resolveSpaceMountLaunchContext(options: {
  workspaceId: string
  workspacePath: string
  space: WorkspaceSpaceState | null
  spaces: WorkspaceSpaceState[]
  onSpacesChange?: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  fallbackToFirstMount?: boolean
}): Promise<{
  space: WorkspaceSpaceState | null
  mount: MountDto | null
  mountId: string | null
  workingDirectory: string
}> {
  const normalizedWorkspacePath =
    typeof options.workspacePath === 'string' ? options.workspacePath : ''
  const fallbackWorkingDirectory = resolveSpaceWorkingDirectory(
    options.space,
    normalizedWorkspacePath,
  )
  const normalizedWorkspaceId =
    typeof options.workspaceId === 'string' ? options.workspaceId.trim() : ''
  const shouldQueryMounts =
    normalizedWorkspaceId.length > 0 &&
    (options.space !== null || options.fallbackToFirstMount === true)

  if (!shouldQueryMounts) {
    return {
      space: options.space,
      mount: null,
      mountId: null,
      workingDirectory: fallbackWorkingDirectory,
    }
  }

  const mounts = await listProjectMounts(normalizedWorkspaceId)
  if (!mounts) {
    if (options.fallbackToFirstMount === true) {
      throw new Error('Control surface unavailable while resolving mounts.')
    }

    return {
      space: options.space,
      mount: null,
      mountId: null,
      workingDirectory: fallbackWorkingDirectory,
    }
  }

  if (options.fallbackToFirstMount === true && options.space === null && mounts.length === 0) {
    throw new Error('No default mount available for this project.')
  }

  const resolved = resolveSpaceMountContext({
    space: options.space,
    workspacePath: normalizedWorkspacePath,
    mounts,
    fallbackToFirstMount: options.fallbackToFirstMount,
  })
  const repairedSpace = applySpaceMountRepair({
    space: options.space,
    repair: resolved.repair,
    spaces: options.spaces,
    onSpacesChange: options.onSpacesChange,
    onRequestPersistFlush: options.onRequestPersistFlush,
  })

  return {
    space: repairedSpace,
    mount: resolved.mount,
    mountId: resolved.mount?.mountId ?? null,
    workingDirectory: resolved.workingDirectory,
  }
}
