import type {
  PersistedAppStateContract,
  PersistedSpaceContract,
  PersistedWorkspaceContract,
} from '@shared/contracts/persistedAppState'
import { isLabelColor } from '@shared/types/labelColor'
import { isProjectIconId } from '@shared/types/projectIcon'
import { isPersistedSpaceArchiveRecord } from './persistedArchiveValidation'
import { isPersistedNode } from './persistedNodeValidation'
import {
  isFiniteNumber,
  isNullableString,
  isRecord,
  isRectOrNull,
  isSpaceBoundary,
  isStringArray,
  isStringRecord,
} from './persistedStateValidationPrimitives'

export type PersistedSettingsValidator<TSettings extends object> = (
  value: unknown,
) => value is TSettings

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
    (value.boundary === undefined || value.boundary === null || isSpaceBoundary(value.boundary)) &&
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

function hasValidSpaceAssignments(
  nodes: PersistedWorkspaceContract['nodes'],
  spaces: PersistedWorkspaceContract['spaces'],
): boolean {
  const nodeIds = new Set(nodes.map(node => node.id))
  const assignedNodeIds = new Set<string>()
  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      if (!nodeIds.has(nodeId) || assignedNodeIds.has(nodeId)) {
        return false
      }
      assignedNodeIds.add(nodeId)
    }
  }
  return true
}

function isPersistedWorkspace(value: unknown): value is PersistedWorkspaceContract {
  if (
    !isRecord(value) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.spaces) ||
    !Array.isArray(value.spaceArchiveRecords)
  ) {
    return false
  }

  const nodes = value.nodes.filter(isPersistedNode)
  const spaces = value.spaces.filter(isPersistedSpace)
  if (
    nodes.length !== value.nodes.length ||
    spaces.length !== value.spaces.length ||
    !value.spaceArchiveRecords.every(isPersistedSpaceArchiveRecord)
  ) {
    return false
  }

  const activeSpaceId = isNullableString(value.activeSpaceId) ? value.activeSpaceId : undefined
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
    activeSpaceId !== undefined &&
    (activeSpaceId === null ||
      spaces.some(space => space.id === activeSpaceId && !space.parentSpaceId)) &&
    (value.pullRequestBaseBranchOptions === undefined ||
      isStringArray(value.pullRequestBaseBranchOptions)) &&
    (value.environmentVariables === undefined || isStringRecord(value.environmentVariables)) &&
    hasUniqueIds(nodes) &&
    hasUniqueIds(spaces) &&
    hasValidSpaceAssignments(nodes, spaces)
  )
}

export function isPersistedAppState<TSettings extends object>(
  value: unknown,
  isSettings: PersistedSettingsValidator<TSettings>,
): value is PersistedAppStateContract<TSettings> {
  if (!isRecord(value) || !Array.isArray(value.workspaces)) {
    return false
  }
  const workspaces = value.workspaces.filter(isPersistedWorkspace)
  if (workspaces.length !== value.workspaces.length || !hasUniqueIds(workspaces)) {
    return false
  }

  const activeWorkspaceId = isNullableString(value.activeWorkspaceId)
    ? value.activeWorkspaceId
    : undefined
  if (
    typeof value.formatVersion !== 'number' ||
    !Number.isSafeInteger(value.formatVersion) ||
    value.formatVersion < 0 ||
    activeWorkspaceId === undefined ||
    (activeWorkspaceId !== null &&
      !workspaces.some(workspace => workspace.id === activeWorkspaceId))
  ) {
    return false
  }

  try {
    return isSettings(value.settings)
  } catch {
    return false
  }
}
