import type {
  PrepareOrReviveSessionInput,
  PreparedRuntimeAgentResult,
  PreparedRuntimeNodeResult,
} from '../../../../shared/contracts/dto'
import { createAppError, getAppErrorDebugMessage } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import {
  normalizePersistedAppState,
  type NormalizedPersistedNode,
  type NormalizedPersistedSpace,
  type NormalizedPersistedWorkspace,
} from '../../../../platform/persistence/sqlite/normalize'
import {
  isRecord,
  normalizeAgentProviderId,
  normalizeOptionalString,
} from './sessionLaunchPayloadSupport'

export type PersistedAgentLike = PreparedRuntimeAgentResult

export function normalizeRuntimeKind(value: unknown): 'windows' | 'wsl' | 'posix' | null {
  return value === 'windows' || value === 'wsl' || value === 'posix' ? value : null
}

export function resolveNodeProfileId(node: NormalizedPersistedNode): string | null {
  return normalizeOptionalString((node as Record<string, unknown>)['profileId'])
}

export function resolveNodeRuntimeKind(
  node: NormalizedPersistedNode,
): 'windows' | 'wsl' | 'posix' | null {
  return normalizeRuntimeKind((node as Record<string, unknown>)['runtimeKind'])
}

export function normalizeWorkspaceIdPayload(payload: unknown): PrepareOrReviveSessionInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.prepareOrRevive.',
    })
  }

  const workspaceIdRaw = payload.workspaceId
  if (typeof workspaceIdRaw !== 'string' || workspaceIdRaw.trim().length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.prepareOrRevive workspaceId.',
    })
  }

  const nodeIdsRaw = payload.nodeIds
  const nodeIds =
    nodeIdsRaw === undefined || nodeIdsRaw === null
      ? null
      : Array.isArray(nodeIdsRaw)
        ? nodeIdsRaw
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim())
            .filter(value => value.length > 0)
        : (() => {
            throw createAppError('common.invalid_input', {
              debugMessage: 'Invalid payload for session.prepareOrRevive nodeIds.',
            })
          })()

  return {
    workspaceId: workspaceIdRaw.trim(),
    ...(nodeIds ? { nodeIds } : {}),
  }
}

export function normalizePersistedAgent(value: unknown): PersistedAgentLike | null {
  if (!isRecord(value)) {
    return null
  }

  const provider = normalizeAgentProviderId(
    value.provider,
    'session.prepareOrRevive agent.provider',
  )
  if (!provider) {
    return null
  }

  const executionDirectory = normalizeOptionalString(value.executionDirectory) ?? ''
  if (executionDirectory.length === 0) {
    return null
  }

  const directoryModeRaw = normalizeOptionalString(value.directoryMode)
  const directoryMode = directoryModeRaw === 'custom' ? 'custom' : 'workspace'

  return {
    provider,
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    model: normalizeOptionalString(value.model),
    effectiveModel: normalizeOptionalString(value.effectiveModel),
    launchMode: value.launchMode === 'resume' ? 'resume' : 'new',
    resumeSessionId: normalizeOptionalString(value.resumeSessionId),
    resumeSessionIdVerified: value.resumeSessionIdVerified === true,
    executionDirectory,
    expectedDirectory: normalizeOptionalString(value.expectedDirectory),
    directoryMode,
    customDirectory: normalizeOptionalString(value.customDirectory),
    shouldCreateDirectory: value.shouldCreateDirectory === true,
    taskId: normalizeOptionalString(value.taskId),
  }
}

export function isActiveAgentStatus(status: string | null): boolean {
  return status === 'running' || status === 'standby' || status === 'restoring'
}

export function isRecoverableAgentWindowStatus(status: string | null): boolean {
  return status !== 'stopped'
}

export function resolveTerminalRecoveryCwd(
  node: NormalizedPersistedNode,
  workspacePath: string,
): string {
  const executionDirectory =
    typeof node.executionDirectory === 'string' ? node.executionDirectory.trim() : ''
  if (executionDirectory.length > 0) {
    return executionDirectory
  }

  const expectedDirectory =
    typeof node.expectedDirectory === 'string' ? node.expectedDirectory.trim() : ''
  if (expectedDirectory.length > 0) {
    return expectedDirectory
  }

  return workspacePath
}

export function resolveOwningSpace(
  workspace: NormalizedPersistedWorkspace,
  nodeId: string,
): NormalizedPersistedSpace | null {
  return workspace.spaces.find(space => space.nodeIds.includes(nodeId)) ?? null
}

export async function resolvePreparedScrollback(options: {
  store: PersistenceStore
  node: NormalizedPersistedNode
}): Promise<string | null> {
  if (options.node.kind !== 'terminal') {
    return null
  }

  const durableScrollback = await options.store.readNodeScrollback(options.node.id)
  return durableScrollback ?? options.node.scrollback
}

export function toPreparedNodeResult(
  node: NormalizedPersistedNode,
  options: Omit<
    PreparedRuntimeNodeResult,
    'nodeId' | 'kind' | 'title' | 'scrollback' | 'terminalGeometry'
  > & {
    scrollback?: string | null
    terminalGeometry?: PreparedRuntimeNodeResult['terminalGeometry']
  },
): PreparedRuntimeNodeResult {
  return {
    nodeId: node.id,
    kind: node.kind === 'agent' ? 'agent' : 'terminal',
    title: node.title,
    ...options,
    terminalGeometry:
      options.terminalGeometry === undefined ? node.terminalGeometry : options.terminalGeometry,
    scrollback: options.scrollback === undefined ? node.scrollback : options.scrollback,
  }
}

export function formatRecoverableError(fallbackMessage: string, error: unknown): string {
  const detail =
    getAppErrorDebugMessage(error instanceof Error || typeof error === 'string' ? error : null) ??
    undefined
  return detail && detail.length > 0 ? `${fallbackMessage}: ${detail}` : fallbackMessage
}

export async function invokeCommand<TResult>(
  controlSurface: ControlSurface,
  ctx: ControlSurfaceContext,
  request: { id: string; payload: unknown },
): Promise<TResult> {
  const result = await controlSurface.invoke(ctx, {
    kind: 'command',
    id: request.id,
    payload: request.payload,
  })

  if (result.ok === false) {
    throw createAppError(result.error)
  }

  return result.value as TResult
}

export { normalizePersistedAppState }
export type { NormalizedPersistedNode, NormalizedPersistedSpace, NormalizedPersistedWorkspace }
