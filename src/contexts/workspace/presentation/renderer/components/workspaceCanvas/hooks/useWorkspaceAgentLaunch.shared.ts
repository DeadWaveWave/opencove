import type { MutableRefObject } from 'react'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import {
  resolveAgentExecutablePathOverride,
  resolveAgentLaunchEnv,
  type AgentProvider,
  type AgentSettings,
} from '@contexts/settings/domain/agentSettings'
import type {
  LaunchAgentSessionResult,
  ListMountsResult,
  TerminalRuntimeKind,
} from '@shared/contracts/dto'
import type { WorkspaceSpaceState } from '../../../types'
import {
  resolveControlSurfaceInvoke,
  shouldUseControlSurfacePlainRuntime,
} from './useWorkspaceRuntimeLaunchRouting'

export interface WorkspaceAgentLaunchBinding {
  mountId: string | null
  executionDirectory: string
}

export interface WorkspaceAgentSessionLaunchResult {
  sessionId: string
  profileId: string | null
  runtimeKind: TerminalRuntimeKind | undefined
  effectiveModel: string | null
  executionDirectory: string
}

export function buildMergedAgentLaunchEnv(
  agentSettings: AgentSettings,
  provider: AgentProvider,
  environmentVariables?: Record<string, string>,
): Record<string, string> {
  const env = resolveAgentLaunchEnv(agentSettings, provider)

  if (!environmentVariables || Object.keys(environmentVariables).length === 0) {
    return env
  }

  return { ...env, ...environmentVariables }
}

export function resolveAgentExecutableOverride(
  agentSettings: AgentSettings,
  provider: AgentProvider,
): string | null {
  return resolveAgentExecutablePathOverride(agentSettings, provider)
}

export function normalizePathForMountComparison(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
}

function mountContainsPath(mountRootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizePathForMountComparison(mountRootPath)
  const normalizedTarget = normalizePathForMountComparison(targetPath)

  if (normalizedRoot.length === 0 || normalizedTarget.length === 0) {
    return false
  }

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

export function resolveBestWorkspaceMount(
  mounts: ListMountsResult['mounts'],
  executionDirectory: string,
): ListMountsResult['mounts'][number] | null {
  if (!Array.isArray(mounts) || mounts.length === 0) {
    return null
  }

  const normalizedDirectory = normalizePathForMountComparison(executionDirectory)
  if (normalizedDirectory.length === 0) {
    return mounts[0] ?? null
  }

  const matches = mounts
    .filter(mount => mountContainsPath(mount.rootPath, normalizedDirectory))
    .sort(
      (a, b) =>
        normalizePathForMountComparison(b.rootPath).length -
        normalizePathForMountComparison(a.rootPath).length,
    )

  return matches[0] ?? null
}

async function listWorkspaceMounts(
  workspaceId: string,
): Promise<ListMountsResult['mounts'] | null> {
  const normalizedWorkspaceId = workspaceId.trim()
  if (normalizedWorkspaceId.length === 0) {
    return null
  }

  const controlSurfaceInvoke = (
    window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
  ).opencoveApi?.controlSurface?.invoke
  if (typeof controlSurfaceInvoke !== 'function') {
    return null
  }

  const mountResult = await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
    kind: 'query',
    id: 'mount.list',
    payload: { projectId: normalizedWorkspaceId },
  })

  return mountResult.mounts
}

function updateSpaceTargetMountId({
  targetSpace,
  nextMountId,
  spacesRef,
  onSpacesChange,
  onRequestPersistFlush,
}: {
  targetSpace: WorkspaceSpaceState | null
  nextMountId: string
  spacesRef?: MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange?: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
}): void {
  if (!targetSpace || targetSpace.targetMountId === nextMountId || !spacesRef || !onSpacesChange) {
    return
  }

  const updatedSpaces = spacesRef.current.map(space =>
    space.id === targetSpace.id ? { ...space, targetMountId: nextMountId } : space,
  )
  spacesRef.current = updatedSpaces
  onSpacesChange(updatedSpaces)
  onRequestPersistFlush?.()
}

export async function resolveWorkspaceAgentLaunchBinding({
  workspaceId,
  workspacePath,
  currentMountId,
  executionDirectory,
  targetSpace,
  spacesRef,
  onSpacesChange,
  onRequestPersistFlush,
  mountQueryFailurePolicy = 'ignore',
}: {
  workspaceId: string
  workspacePath: string
  currentMountId: string | null
  executionDirectory: string
  targetSpace: WorkspaceSpaceState | null
  spacesRef?: MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange?: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  mountQueryFailurePolicy?: 'ignore' | 'throw'
}): Promise<WorkspaceAgentLaunchBinding> {
  let mountId = currentMountId
  let nextExecutionDirectory = executionDirectory
  let mounts: ListMountsResult['mounts'] | null = null

  try {
    mounts = await listWorkspaceMounts(workspaceId)
  } catch (error) {
    if (mountQueryFailurePolicy === 'throw') {
      throw error
    }

    return {
      mountId,
      executionDirectory: nextExecutionDirectory,
    }
  }

  if (!mounts || mounts.length === 0) {
    return {
      mountId,
      executionDirectory: nextExecutionDirectory,
    }
  }

  const hasCurrentMountId =
    typeof mountId === 'string' &&
    mountId.trim().length > 0 &&
    mounts.some(mount => mount.mountId === mountId)

  if (hasCurrentMountId) {
    return {
      mountId,
      executionDirectory: nextExecutionDirectory,
    }
  }

  const resolvedMount = resolveBestWorkspaceMount(mounts, nextExecutionDirectory)
  if (!resolvedMount) {
    return {
      mountId,
      executionDirectory: nextExecutionDirectory,
    }
  }

  mountId = resolvedMount.mountId
  updateSpaceTargetMountId({
    targetSpace,
    nextMountId: mountId,
    spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
  })

  const normalizedDirectory = normalizePathForMountComparison(nextExecutionDirectory)
  const normalizedWorkspacePath = normalizePathForMountComparison(workspacePath)
  if (normalizedDirectory.length === 0 || normalizedDirectory === normalizedWorkspacePath) {
    nextExecutionDirectory = resolvedMount.rootPath
  }

  return {
    mountId,
    executionDirectory: nextExecutionDirectory,
  }
}

export async function launchWorkspaceAgentSession({
  mountId,
  workspacePath,
  executionDirectory,
  prompt,
  provider,
  mode,
  model,
  resumeSessionId = null,
  executablePathOverride,
  mergedEnv,
  agentSettings,
  launchGeometry,
  retryResolveMountBinding,
}: {
  mountId: string | null
  workspacePath: string
  executionDirectory: string
  prompt: string
  provider: AgentProvider
  mode: 'new' | 'resume'
  model: string | null
  resumeSessionId?: string | null
  executablePathOverride?: string | null
  mergedEnv: Record<string, string>
  agentSettings: Pick<AgentSettings, 'agentFullAccess' | 'defaultTerminalProfileId'>
  launchGeometry: { terminalGeometry: { cols: number; rows: number } }
  retryResolveMountBinding?: (failedMountId: string) => Promise<WorkspaceAgentLaunchBinding | null>
}): Promise<WorkspaceAgentSessionLaunchResult> {
  const invokeLaunchInMount = async (
    nextMountId: string,
    nextExecutionDirectory: string,
  ): Promise<LaunchAgentSessionResult> => {
    const cwd = nextExecutionDirectory.trim()
    const cwdUri = cwd.length > 0 ? toFileUri(cwd) : null
    return await window.opencoveApi.controlSurface.invoke<LaunchAgentSessionResult>({
      kind: 'command',
      id: 'session.launchAgentInMount',
      payload: {
        mountId: nextMountId,
        cwdUri,
        prompt,
        provider,
        mode,
        model,
        resumeSessionId: mode === 'resume' ? resumeSessionId : null,
        ...(executablePathOverride ? { executablePathOverride } : {}),
        ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
        agentFullAccess: agentSettings.agentFullAccess,
        cols: launchGeometry.terminalGeometry.cols,
        rows: launchGeometry.terminalGeometry.rows,
      },
    })
  }

  if (mountId) {
    let launchMountId = mountId
    let launchExecutionDirectory = executionDirectory

    try {
      const launched = await invokeLaunchInMount(launchMountId, launchExecutionDirectory)
      return {
        sessionId: launched.sessionId,
        profileId: launched.profileId ?? null,
        runtimeKind: launched.runtimeKind ?? undefined,
        effectiveModel: launched.effectiveModel,
        executionDirectory: launched.executionContext.workingDirectory,
      }
    } catch (error) {
      if (!retryResolveMountBinding) {
        throw error
      }

      const nextBinding = await retryResolveMountBinding(launchMountId)
      if (
        !nextBinding?.mountId ||
        (nextBinding.mountId === launchMountId &&
          nextBinding.executionDirectory === launchExecutionDirectory)
      ) {
        throw error
      }

      launchMountId = nextBinding.mountId
      launchExecutionDirectory = nextBinding.executionDirectory

      const launched = await invokeLaunchInMount(launchMountId, launchExecutionDirectory)
      return {
        sessionId: launched.sessionId,
        profileId: launched.profileId ?? null,
        runtimeKind: launched.runtimeKind ?? undefined,
        effectiveModel: launched.effectiveModel,
        executionDirectory: launched.executionContext.workingDirectory,
      }
    }
  }

  const controlSurfaceInvoke = resolveControlSurfaceInvoke()
  if (
    controlSurfaceInvoke &&
    shouldUseControlSurfacePlainRuntime({ workspacePath, executionDirectory })
  ) {
    const launched = await controlSurfaceInvoke<LaunchAgentSessionResult>({
      kind: 'command',
      id: 'session.launchAgent',
      payload: {
        cwd: executionDirectory,
        prompt,
        provider,
        mode,
        model,
        resumeSessionId: mode === 'resume' ? resumeSessionId : null,
        ...(executablePathOverride ? { executablePathOverride } : {}),
        ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
        agentFullAccess: agentSettings.agentFullAccess,
        cols: launchGeometry.terminalGeometry.cols,
        rows: launchGeometry.terminalGeometry.rows,
      },
    })

    return {
      sessionId: launched.sessionId,
      profileId: launched.profileId ?? null,
      runtimeKind: launched.runtimeKind ?? undefined,
      effectiveModel: launched.effectiveModel,
      executionDirectory: launched.executionContext.workingDirectory,
    }
  }

  const launched = await window.opencoveApi.agent.launch({
    provider,
    cwd: executionDirectory,
    profileId: agentSettings.defaultTerminalProfileId,
    prompt,
    mode,
    model,
    resumeSessionId: mode === 'resume' ? resumeSessionId : null,
    ...(executablePathOverride ? { executablePathOverride } : {}),
    ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
    agentFullAccess: agentSettings.agentFullAccess,
    cols: launchGeometry.terminalGeometry.cols,
    rows: launchGeometry.terminalGeometry.rows,
  })

  return {
    sessionId: launched.sessionId,
    profileId: launched.profileId ?? null,
    runtimeKind: launched.runtimeKind,
    effectiveModel: launched.effectiveModel,
    executionDirectory,
  }
}
