import type {
  PersistedAppStateContract,
  PersistedNodeContract,
  PersistedSpaceContract,
  PersistedWorkspaceContract,
} from '@shared/contracts/persistedAppState'
import { isLabelColor } from '@shared/types/labelColor'
import { isProjectIconId } from '@shared/types/projectIcon'

const WORKSPACE_NODE_KINDS = new Set([
  'terminal',
  'agent',
  'task',
  'note',
  'role',
  'image',
  'document',
  'website',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string')
}

function isNullableStringArray(value: unknown): value is string[] | null {
  return value === null || isStringArray(value)
}

function isNodeWorkerBinding(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isRecord(value) &&
      typeof value.endpointId === 'string' &&
      value.endpointId.trim().length > 0 &&
      isNullableString(value.mountId))
  )
}

function isSpaceBoundary(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true
  }
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
    isNullableStringArray(value.allowedPluginIds) &&
    isNullableStringArray(value.capabilities) &&
    (value.trustLevel === null ||
      value.trustLevel === 'trusted' ||
      value.trustLevel === 'restricted' ||
      value.trustLevel === 'untrusted')
  )
}

function isPoint(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

function isRectOrNull(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y) &&
      isFiniteNumber(value.width) &&
      isFiniteNumber(value.height))
  )
}

function isPersistedNode(value: unknown): value is PersistedNodeContract {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.title === 'string' &&
    isPoint(value.position) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    typeof value.kind === 'string' &&
    WORKSPACE_NODE_KINDS.has(value.kind) &&
    (value.sidebarSortOrder === undefined ||
      value.sidebarSortOrder === null ||
      isFiniteNumber(value.sidebarSortOrder)) &&
    isNodeWorkerBinding(value.workerBinding) &&
    isNullableString(value.status) &&
    isNullableString(value.startedAt) &&
    isNullableString(value.endedAt) &&
    (value.exitCode === null || isFiniteNumber(value.exitCode)) &&
    isNullableString(value.lastError) &&
    isNullableString(value.scrollback) &&
    (value.agent === null || isRecord(value.agent)) &&
    (value.task === null || isRecord(value.task))
  )
}

function isPersistedSpace(value: unknown): value is PersistedSpaceContract {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    typeof value.directoryPath === 'string' &&
    isNullableString(value.targetMountId) &&
    (value.parentSpaceId === undefined || isNullableString(value.parentSpaceId)) &&
    isSpaceBoundary(value.boundary) &&
    (value.sortOrder === undefined || isFiniteNumber(value.sortOrder)) &&
    (value.pinned === undefined || typeof value.pinned === 'boolean') &&
    (value.labelColor === null || isLabelColor(value.labelColor)) &&
    isStringArray(value.nodeIds) &&
    isRectOrNull(value.rect)
  )
}

function hasUniqueIds(values: readonly { id: string }[]): boolean {
  return new Set(values.map(value => value.id)).size === values.length
}

function isPersistedWorkspace(value: unknown): value is PersistedWorkspaceContract {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.spaces)) {
    return false
  }
  const nodes = value.nodes.filter(isPersistedNode)
  const spaces = value.spaces.filter(isPersistedSpace)
  if (nodes.length !== value.nodes.length || spaces.length !== value.spaces.length) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    typeof value.worktreesRoot === 'string' &&
    (value.iconId === undefined || value.iconId === null || isProjectIconId(value.iconId)) &&
    isRecord(value.viewport) &&
    isFiniteNumber(value.viewport.x) &&
    isFiniteNumber(value.viewport.y) &&
    isFiniteNumber(value.viewport.zoom) &&
    value.viewport.zoom > 0 &&
    typeof value.isMinimapVisible === 'boolean' &&
    isNullableString(value.activeSpaceId) &&
    Array.isArray(value.spaceArchiveRecords) &&
    (value.pullRequestBaseBranchOptions === undefined ||
      isStringArray(value.pullRequestBaseBranchOptions)) &&
    (value.environmentVariables === undefined || isStringRecord(value.environmentVariables)) &&
    hasUniqueIds(nodes) &&
    hasUniqueIds(spaces)
  )
}

export function isPersistedAppState(value: unknown): value is PersistedAppStateContract {
  if (!isRecord(value) || !Array.isArray(value.workspaces)) {
    return false
  }
  const workspaces = value.workspaces.filter(isPersistedWorkspace)
  if (workspaces.length !== value.workspaces.length || !hasUniqueIds(workspaces)) {
    return false
  }
  return (
    typeof value.formatVersion === 'number' &&
    Number.isSafeInteger(value.formatVersion) &&
    value.formatVersion >= 0 &&
    isNullableString(value.activeWorkspaceId) &&
    isRecord(value.settings)
  )
}
