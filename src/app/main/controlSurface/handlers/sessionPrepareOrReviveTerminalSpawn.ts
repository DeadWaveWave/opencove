import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import { resolveSpaceMountContext } from '../../../../contexts/space/application/resolveSpaceMountContext'
import type { MountDto, SpawnTerminalResult } from '../../../../shared/contracts/dto'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import { invokeCommand } from './sessionPrepareOrReviveShared'
import {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  type PtyGeometry,
} from './sessionPrepareOrReviveGeometry'
import type {
  NormalizedPersistedSpace,
  NormalizedPersistedWorkspace,
} from './sessionPrepareOrReviveShared'

export type PrepareOrReviveLaunchContext = {
  mountId: string | null
  workingDirectory: string
}

async function listWorkspaceMounts(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  workspaceId: string
}): Promise<MountDto[]> {
  try {
    const result = await options.controlSurface.invoke(options.ctx, {
      kind: 'query',
      id: 'mount.list',
      payload: { projectId: options.workspaceId },
    })

    if (result.ok === false) {
      return []
    }

    const value = result.value as { mounts?: unknown }
    return Array.isArray(value.mounts) ? (value.mounts as MountDto[]) : []
  } catch {
    return []
  }
}

export async function resolvePrepareOrReviveLaunchContext(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  workspace: NormalizedPersistedWorkspace
  space: NormalizedPersistedSpace | null
  cwd: string
}): Promise<PrepareOrReviveLaunchContext> {
  if (!options.space) {
    return {
      mountId: null,
      workingDirectory: options.cwd,
    }
  }

  const mounts = await listWorkspaceMounts({
    controlSurface: options.controlSurface,
    ctx: options.ctx,
    workspaceId: options.workspace.id,
  })
  const resolved = resolveSpaceMountContext({
    space: {
      directoryPath: options.cwd,
      targetMountId: options.space.targetMountId,
      boundary: options.space.boundary,
    },
    workspacePath: options.workspace.path,
    mounts,
  })

  return {
    mountId: resolved.mount?.mountId ?? null,
    workingDirectory: resolved.workingDirectory,
  }
}

export async function spawnFallbackTerminal(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  workspace: NormalizedPersistedWorkspace
  space: NormalizedPersistedSpace | null
  cwd: string
  profileId: string | null
  geometry?: PtyGeometry
}): Promise<SpawnTerminalResult & { cwd: string }> {
  const geometry = options.geometry ?? { cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS }
  const launchContext = await resolvePrepareOrReviveLaunchContext({
    controlSurface: options.controlSurface,
    ctx: options.ctx,
    workspace: options.workspace,
    space: options.space,
    cwd: options.cwd,
  })

  if (launchContext.mountId) {
    const spawned = await invokeCommand<SpawnTerminalResult>(options.controlSurface, options.ctx, {
      id: 'pty.spawnInMount',
      payload: {
        mountId: launchContext.mountId,
        cwdUri: toFileUri(launchContext.workingDirectory),
        profileId: options.profileId,
        cols: geometry.cols,
        rows: geometry.rows,
      },
    })
    return { ...spawned, cwd: launchContext.workingDirectory }
  }

  const spawned = await invokeCommand<SpawnTerminalResult>(options.controlSurface, options.ctx, {
    id: 'pty.spawn',
    payload: {
      cwd: launchContext.workingDirectory,
      profileId: options.profileId,
      cols: geometry.cols,
      rows: geometry.rows,
    },
  })
  return { ...spawned, cwd: launchContext.workingDirectory }
}
