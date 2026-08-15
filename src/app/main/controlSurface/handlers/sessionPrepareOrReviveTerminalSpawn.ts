import { logAgentLaunchInfo } from '../../diagnostics/agentLaunchRuntimeDiagnostics'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import { resolveSpaceMountContext } from '../../../../contexts/space/application/resolveSpaceMountContext'
import type { MountDto, SpawnTerminalResult } from '../../../../shared/contracts/dto'
import {
  isRemoteNodeWorkerBinding,
  type NodeWorkerBinding,
} from '../../../../shared/types/nodeWorkerBinding'
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
  NormalizedPersistedNode,
  NormalizedPersistedWorkspace,
} from './sessionPrepareOrReviveShared'

export type PrepareOrReviveLaunchContext = {
  resolution: 'resolved' | 'unresolved_remote'
  mountId: string | null
  endpointId: string
  workerBinding: NodeWorkerBinding
  workingDirectory: string
  reason: string
}

async function listWorkspaceMounts(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  workspaceId: string
}): Promise<MountDto[] | null> {
  try {
    const result = await options.controlSurface.invoke(options.ctx, {
      kind: 'query',
      id: 'mount.list',
      payload: { projectId: options.workspaceId },
    })

    if (result.ok === false) {
      return null
    }

    const value = result.value as { mounts?: unknown }
    return Array.isArray(value.mounts) ? (value.mounts as MountDto[]) : []
  } catch {
    return null
  }
}

function logLocalWorkerDecision(options: {
  nodeId: string
  workspaceId: string
  mountId: string | null
  reason: string
}): void {
  logAgentLaunchInfo(
    'session-recovery-selected-local-worker',
    'Session recovery selected the local worker.',
    {
      nodeId: options.nodeId,
      workspaceId: options.workspaceId,
      mountId: options.mountId,
      reason: options.reason,
    },
  )
}

function resolvedContext(options: {
  nodeId: string
  workspaceId: string
  mountId: string | null
  endpointId: string
  workingDirectory: string
  reason: string
}): PrepareOrReviveLaunchContext {
  if (options.endpointId === 'local') {
    logLocalWorkerDecision(options)
  }

  return {
    resolution: 'resolved',
    mountId: options.mountId,
    endpointId: options.endpointId,
    workerBinding: {
      endpointId: options.endpointId,
      mountId: options.mountId,
    },
    workingDirectory: options.workingDirectory,
    reason: options.reason,
  }
}

export async function resolvePrepareOrReviveLaunchContext(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  workspace: NormalizedPersistedWorkspace
  node: NormalizedPersistedNode
  space: NormalizedPersistedSpace | null
  cwd: string
}): Promise<PrepareOrReviveLaunchContext> {
  const nodeBinding = options.node.workerBinding
  if (nodeBinding) {
    if (nodeBinding.endpointId === 'local' && !nodeBinding.mountId) {
      return resolvedContext({
        nodeId: options.node.id,
        workspaceId: options.workspace.id,
        mountId: null,
        endpointId: 'local',
        workingDirectory: options.cwd,
        reason: 'node_binding_local',
      })
    }

    const mounts = await listWorkspaceMounts({
      controlSurface: options.controlSurface,
      ctx: options.ctx,
      workspaceId: options.workspace.id,
    })
    const boundMount = mounts?.find(mount => mount.mountId === nodeBinding.mountId) ?? null
    if (boundMount && boundMount.endpointId === nodeBinding.endpointId) {
      return resolvedContext({
        nodeId: options.node.id,
        workspaceId: options.workspace.id,
        mountId: boundMount.mountId,
        endpointId: boundMount.endpointId,
        workingDirectory: options.cwd,
        reason: 'node_binding_mount',
      })
    }

    if (isRemoteNodeWorkerBinding(nodeBinding)) {
      return {
        resolution: 'unresolved_remote',
        mountId: nodeBinding.mountId,
        endpointId: nodeBinding.endpointId,
        workerBinding: nodeBinding,
        workingDirectory: options.cwd,
        reason: mounts === null ? 'mount_query_failed' : 'bound_mount_unresolved',
      }
    }

    return resolvedContext({
      nodeId: options.node.id,
      workspaceId: options.workspace.id,
      mountId: null,
      endpointId: 'local',
      workingDirectory: options.cwd,
      reason: 'local_binding_mount_unresolved',
    })
  }

  if (!options.space) {
    return resolvedContext({
      nodeId: options.node.id,
      workspaceId: options.workspace.id,
      mountId: null,
      endpointId: 'local',
      workingDirectory: options.cwd,
      reason: 'legacy_node_without_space',
    })
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
    mounts: mounts ?? [],
  })

  return resolvedContext({
    nodeId: options.node.id,
    workspaceId: options.workspace.id,
    mountId: resolved.mount?.mountId ?? null,
    endpointId: resolved.mount?.endpointId ?? 'local',
    workingDirectory: resolved.workingDirectory,
    reason: resolved.mount ? 'legacy_space_mount' : 'legacy_space_without_mount',
  })
}

export class RemoteWorkerBindingUnresolvedError extends Error {
  constructor(readonly launchContext: PrepareOrReviveLaunchContext) {
    super(`Remote worker binding could not be resolved (${launchContext.reason}).`)
    this.name = 'RemoteWorkerBindingUnresolvedError'
  }
}

export async function spawnFallbackTerminal(options: {
  controlSurface: ControlSurface
  ctx: ControlSurfaceContext
  workspace: NormalizedPersistedWorkspace
  node: NormalizedPersistedNode
  space: NormalizedPersistedSpace | null
  cwd: string
  profileId: string | null
  geometry?: PtyGeometry
  launchContext?: PrepareOrReviveLaunchContext
}): Promise<SpawnTerminalResult & { cwd: string; workerBinding: NodeWorkerBinding }> {
  const geometry = options.geometry ?? { cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS }
  const launchContext =
    options.launchContext ??
    (await resolvePrepareOrReviveLaunchContext({
      controlSurface: options.controlSurface,
      ctx: options.ctx,
      workspace: options.workspace,
      node: options.node,
      space: options.space,
      cwd: options.cwd,
    }))

  if (launchContext.resolution === 'unresolved_remote') {
    throw new RemoteWorkerBindingUnresolvedError(launchContext)
  }

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
    return {
      ...spawned,
      cwd: launchContext.workingDirectory,
      workerBinding: launchContext.workerBinding,
    }
  }

  const spawned = await invokeCommand<SpawnTerminalResult>(options.controlSurface, options.ctx, {
    id: 'pty.spawn',
    payload: {
      cwd: launchContext.workingDirectory,
      workspaceId: options.workspace.id,
      profileId: options.profileId,
      cols: geometry.cols,
      rows: geometry.rows,
    },
  })
  return {
    ...spawned,
    cwd: launchContext.workingDirectory,
    workerBinding: launchContext.workerBinding,
  }
}
