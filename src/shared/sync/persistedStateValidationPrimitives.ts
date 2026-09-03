import { AGENT_PROVIDER_IDS, CANVAS_IMAGE_MIME_TYPES } from '@shared/contracts/dto'
import {
  PERSISTED_WORKSPACE_NODE_KINDS,
  type PersistedAgentRuntimeStatus,
  type PersistedExecutionDirectoryMode,
  type PersistedNodeFrame,
  type PersistedPoint,
  type PersistedSpaceRect,
  type PersistedTaskRuntimeStatus,
  type PersistedWorkspaceNodeKind,
} from '@shared/contracts/persistedAppState'
import { isLabelColor, type NodeLabelColorOverride } from '@shared/types/labelColor'
import type { SpaceBoundary } from '@shared/types/spaceBoundary'

const AGENT_RUNTIME_STATUSES = new Set<PersistedAgentRuntimeStatus>([
  'running',
  'standby',
  'waiting',
  'exited',
  'failed',
  'stopped',
  'restoring',
])
const TASK_RUNTIME_STATUSES = new Set<PersistedTaskRuntimeStatus>([
  'todo',
  'doing',
  'ai_done',
  'done',
])

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

export function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value)
}

export function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string')
}

export function isAgentProvider(value: unknown): boolean {
  return typeof value === 'string' && (AGENT_PROVIDER_IDS as readonly string[]).includes(value)
}

export function isNullableAgentProvider(value: unknown): boolean {
  return value === null || isAgentProvider(value)
}

export function isAgentRuntimeStatus(value: unknown): value is PersistedAgentRuntimeStatus {
  return (
    typeof value === 'string' && AGENT_RUNTIME_STATUSES.has(value as PersistedAgentRuntimeStatus)
  )
}

export function isNullableAgentRuntimeStatus(value: unknown): boolean {
  return value === null || isAgentRuntimeStatus(value)
}

export function isTaskRuntimeStatus(value: unknown): value is PersistedTaskRuntimeStatus {
  return typeof value === 'string' && TASK_RUNTIME_STATUSES.has(value as PersistedTaskRuntimeStatus)
}

export function isTaskPriority(value: unknown): boolean {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent'
}

export function isLaunchMode(value: unknown): boolean {
  return value === 'new' || value === 'resume'
}

export function isNullableLaunchMode(value: unknown): boolean {
  return value === null || isLaunchMode(value)
}

export function isExecutionDirectoryMode(value: unknown): value is PersistedExecutionDirectoryMode {
  return value === 'workspace' || value === 'custom'
}

export function isNullableExecutionDirectoryMode(value: unknown): boolean {
  return value === null || isExecutionDirectoryMode(value)
}

export function isTerminalRuntimeKind(value: unknown): boolean {
  return value === 'windows' || value === 'wsl' || value === 'posix'
}

export function isNullableTerminalRuntimeKind(value: unknown): boolean {
  return value === null || isTerminalRuntimeKind(value)
}

export function isWorkspaceNodeKind(value: unknown): value is PersistedWorkspaceNodeKind {
  return (
    typeof value === 'string' &&
    (PERSISTED_WORKSPACE_NODE_KINDS as readonly string[]).includes(value)
  )
}

export function isNodeLabelColorOverride(value: unknown): value is NodeLabelColorOverride {
  return value === null || value === 'none' || isLabelColor(value)
}

export function isPoint(value: unknown): value is PersistedPoint {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

export function isRectOrNull(value: unknown): value is PersistedSpaceRect | null {
  return (
    value === null ||
    (isRecord(value) &&
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y) &&
      isFiniteNumber(value.width) &&
      isFiniteNumber(value.height))
  )
}

export function isNodeFrameOrNull(value: unknown): value is PersistedNodeFrame | null {
  return (
    value === null ||
    (isRecord(value) &&
      isPoint(value.position) &&
      isRecord(value.size) &&
      isPositiveFiniteNumber(value.size.width) &&
      isPositiveFiniteNumber(value.size.height))
  )
}

export function isTerminalGeometry(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.cols) &&
    (value.cols as number) > 0 &&
    Number.isSafeInteger(value.rows) &&
    (value.rows as number) > 0 &&
    (value.revision === undefined ||
      value.revision === null ||
      (Number.isSafeInteger(value.revision) && (value.revision as number) >= 0))
  )
}

export function isSpaceBoundary(value: unknown): value is SpaceBoundary {
  if (!isRecord(value) || !isStringArray(value.allowedMountIds)) {
    return false
  }
  if (
    !isRecord(value.scopesByMountId) ||
    !Object.values(value.scopesByMountId).every(
      scope =>
        isRecord(scope) && typeof scope.rootPath === 'string' && typeof scope.rootUri === 'string',
    )
  ) {
    return false
  }
  return (
    (value.allowedPluginIds === null || isStringArray(value.allowedPluginIds)) &&
    (value.capabilities === null || isStringArray(value.capabilities)) &&
    (value.trustLevel === null ||
      value.trustLevel === 'trusted' ||
      value.trustLevel === 'restricted' ||
      value.trustLevel === 'untrusted')
  )
}

export function isCanvasImageMimeType(value: unknown): boolean {
  return typeof value === 'string' && (CANVAS_IMAGE_MIME_TYPES as readonly string[]).includes(value)
}
