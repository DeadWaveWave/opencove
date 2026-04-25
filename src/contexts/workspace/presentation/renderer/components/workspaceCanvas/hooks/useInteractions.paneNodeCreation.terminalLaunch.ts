import { isAllocateProjectPlaceholderPath } from '@app/renderer/shell/utils/projectPlaceholderPath'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import type { ListMountsResult } from '@shared/contracts/dto'
import type { PersistedAppState, Point, WorkspaceSpaceState } from '../../../types'
import { findContainingSpaceByAnchor } from './useInteractions.spaceAssignment'

function resolvePersistedWorkspaceForTerminalLaunch(
  state: unknown,
  workspaceId: string,
): PersistedAppState['workspaces'][number] | null {
  if (
    !state ||
    typeof state !== 'object' ||
    !Array.isArray((state as PersistedAppState).workspaces)
  ) {
    return null
  }

  const persistedState = state as PersistedAppState
  const normalizedWorkspaceId = workspaceId.trim()
  if (normalizedWorkspaceId.length > 0) {
    const matchingWorkspace =
      persistedState.workspaces.find(workspace => workspace.id === normalizedWorkspaceId) ?? null
    if (matchingWorkspace) {
      return matchingWorkspace
    }
  }

  const activeWorkspaceId =
    typeof persistedState.activeWorkspaceId === 'string'
      ? persistedState.activeWorkspaceId.trim()
      : ''
  if (activeWorkspaceId.length > 0) {
    const activeWorkspace =
      persistedState.workspaces.find(workspace => workspace.id === activeWorkspaceId) ?? null
    if (activeWorkspace) {
      return activeWorkspace
    }
  }

  return persistedState.workspaces[0] ?? null
}

function resolveFallbackTargetSpace(
  workspace: PersistedAppState['workspaces'][number],
  anchor: Point,
): WorkspaceSpaceState | null {
  return (
    findContainingSpaceByAnchor(workspace.spaces, anchor) ??
    workspace.spaces.find(space => space.id === workspace.activeSpaceId) ??
    workspace.spaces[0] ??
    null
  )
}

export async function resolveTerminalLaunchWorkspaceContext(options: {
  anchor: Point
  workspaceId: string
  workspacePath: string
  targetSpace: WorkspaceSpaceState | null
}): Promise<{
  workspacePath: string
  targetSpace: WorkspaceSpaceState | null
}> {
  const normalizedWorkspacePath = options.workspacePath.trim()
  if (
    resolveSpaceWorkingDirectory(options.targetSpace, normalizedWorkspacePath).trim().length > 0
  ) {
    return {
      workspacePath: normalizedWorkspacePath,
      targetSpace: options.targetSpace,
    }
  }

  const readAppState = window.opencoveApi.persistence?.readAppState
  if (typeof readAppState !== 'function') {
    return {
      workspacePath: normalizedWorkspacePath,
      targetSpace: options.targetSpace,
    }
  }

  try {
    const appState = await readAppState()
    const workspace = resolvePersistedWorkspaceForTerminalLaunch(
      appState.state,
      options.workspaceId,
    )
    if (!workspace) {
      return {
        workspacePath: normalizedWorkspacePath,
        targetSpace: options.targetSpace,
      }
    }

    return {
      workspacePath: workspace.path,
      targetSpace: options.targetSpace ?? resolveFallbackTargetSpace(workspace, options.anchor),
    }
  } catch {
    return {
      workspacePath: normalizedWorkspacePath,
      targetSpace: options.targetSpace,
    }
  }
}

export async function resolveDefaultMountFallback(options: {
  workspaceId: string
  workspacePath: string
}): Promise<{ mountId: string; rootPath: string } | null> {
  const normalizedWorkspaceId = options.workspaceId.trim()
  if (
    normalizedWorkspaceId.length === 0 ||
    !isAllocateProjectPlaceholderPath(options.workspacePath, normalizedWorkspaceId)
  ) {
    return null
  }

  const controlSurfaceInvoke = (
    window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
  ).opencoveApi?.controlSurface?.invoke

  if (typeof controlSurfaceInvoke !== 'function') {
    throw new Error('Control surface unavailable while resolving default mount.')
  }

  const mountResult = await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
    kind: 'query',
    id: 'mount.list',
    payload: { projectId: normalizedWorkspaceId },
  })

  const mount = mountResult.mounts[0] ?? null
  if (!mount) {
    throw new Error('No default mount available for this project.')
  }

  return {
    mountId: mount.mountId,
    rootPath: mount.rootPath,
  }
}
