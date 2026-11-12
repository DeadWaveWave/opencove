import { canonicalContent } from '@shared/sync/mergeValue'
import type { Node } from '@xyflow/react'
import type {
  SpaceArchiveRecord,
  TaskNodeData,
  TerminalNodeData,
  WorkspaceSpaceRect,
} from '@contexts/workspace/presentation/renderer/types'
import type { SpaceBoundary } from '@shared/types/spaceBoundary'
import { areStringArraysEqual, isSpaceBoundaryEqual } from '@shared/sync/spaceBoundaryEquality'
import { areNodeWorkerBindingsEqual } from '@shared/types/nodeWorkerBinding'

type UnknownRecord = Record<string, unknown>

function isNodePositionEqual(
  left: Node<TerminalNodeData> | null,
  right: Node<TerminalNodeData> | null,
): boolean {
  if (!left || !right) {
    return false
  }
  return left.position.x === right.position.x && left.position.y === right.position.y
}

function isNodeSizeEqual(
  left: Node<TerminalNodeData> | null,
  right: Node<TerminalNodeData> | null,
): boolean {
  if (!left || !right) {
    return false
  }
  return left.width === right.width && left.height === right.height
}

export function shallowEqualRecord(left: UnknownRecord, right: UnknownRecord): boolean {
  if (left === right) {
    return true
  }
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  for (const key of leftKeys) {
    if (!(key in right)) {
      return false
    }
    if (left[key] !== right[key]) {
      return false
    }
  }
  return true
}

export { areStringArraysEqual }

function isTaskDataEquivalent(left: TaskNodeData, right: TaskNodeData): boolean {
  const { tags: leftTags, agentSessions: leftSessions, ...leftFields } = left
  const { tags: rightTags, agentSessions: rightSessions, ...rightFields } = right
  // Worker snapshots deserialize fresh arrays. Their identity is not a task edit; retaining
  // the node also keeps the workspace's collapse context stable for the native website.
  return (
    shallowEqualRecord(leftFields, rightFields) &&
    areStringArraysEqual(leftTags, rightTags) &&
    leftSessions.length === rightSessions.length &&
    leftSessions.every((session, index) =>
      shallowEqualRecord(
        session as unknown as UnknownRecord,
        rightSessions[index] as unknown as UnknownRecord,
      ),
    )
  )
}

export function isWorkspaceSpaceRectEqual(
  left: WorkspaceSpaceRect | null,
  right: WorkspaceSpaceRect | null,
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

export function isWorkspaceSpaceBoundaryEqual(
  left: SpaceBoundary | null | undefined,
  right: SpaceBoundary | null | undefined,
): boolean {
  return isSpaceBoundaryEqual(left, right)
}

export function areSpaceArchiveRecordsEquivalent(
  left: SpaceArchiveRecord[],
  right: SpaceArchiveRecord[],
): boolean {
  if (left === right) {
    return true
  }

  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftRecord = left[index]
    const rightRecord = right[index]

    if (
      leftRecord.id !== rightRecord.id ||
      leftRecord.archivedAt !== rightRecord.archivedAt ||
      leftRecord.nodes.length !== rightRecord.nodes.length ||
      leftRecord.space.id !== rightRecord.space.id
    ) {
      return false
    }
  }

  return true
}

function isNodeDataEquivalent(persisted: TerminalNodeData, existing: TerminalNodeData): boolean {
  if (persisted.kind !== existing.kind) {
    return false
  }

  if (
    JSON.stringify(persisted.managedClaudeResumeBindingOwnership ?? null) !==
      JSON.stringify(existing.managedClaudeResumeBindingOwnership ?? null) ||
    persisted.sessionId !== existing.sessionId ||
    persisted.runtimeSessionBinding !== existing.runtimeSessionBinding ||
    persisted.title !== existing.title ||
    persisted.titlePinnedByUser !== existing.titlePinnedByUser ||
    persisted.titleIsLiteral !== existing.titleIsLiteral ||
    persisted.width !== existing.width ||
    persisted.height !== existing.height ||
    persisted.profileId !== existing.profileId ||
    persisted.runtimeKind !== existing.runtimeKind ||
    !areNodeWorkerBindingsEqual(persisted.workerBinding ?? null, existing.workerBinding ?? null) ||
    (persisted.labelColorOverride ?? null) !== (existing.labelColorOverride ?? null) ||
    (persisted.sidebarSortOrder ?? null) !== (existing.sidebarSortOrder ?? null) ||
    persisted.status !== existing.status ||
    persisted.startedAt !== existing.startedAt ||
    persisted.endedAt !== existing.endedAt ||
    persisted.exitCode !== existing.exitCode ||
    persisted.lastError !== existing.lastError ||
    (persisted.executionDirectory ?? null) !== (existing.executionDirectory ?? null) ||
    (persisted.expectedDirectory ?? null) !== (existing.expectedDirectory ?? null)
  ) {
    return false
  }

  if ((persisted.agent ?? null) !== (existing.agent ?? null)) {
    if (!persisted.agent || !existing.agent) {
      return false
    }

    if (
      !shallowEqualRecord(
        persisted.agent as unknown as UnknownRecord,
        existing.agent as unknown as UnknownRecord,
      )
    ) {
      return false
    }
  }

  const persistedTask = persisted.task ?? null
  const existingTask = existing.task ?? null
  if ((persistedTask ?? null) !== (existingTask ?? null)) {
    if (!persistedTask || !existingTask) {
      return false
    }

    if (!isTaskDataEquivalent(persistedTask, existingTask)) {
      return false
    }
  }

  const persistedNote = persisted.note ?? null
  const existingNote = existing.note ?? null
  if ((persistedNote ?? null) !== (existingNote ?? null)) {
    if (!persistedNote || !existingNote) {
      return false
    }

    if (
      !shallowEqualRecord(
        persistedNote as unknown as UnknownRecord,
        existingNote as unknown as UnknownRecord,
      )
    ) {
      return false
    }
  }

  const persistedImage = persisted.image ?? null
  const existingImage = existing.image ?? null
  if ((persistedImage ?? null) !== (existingImage ?? null)) {
    if (!persistedImage || !existingImage) {
      return false
    }

    if (
      !shallowEqualRecord(
        persistedImage as unknown as UnknownRecord,
        existingImage as unknown as UnknownRecord,
      )
    ) {
      return false
    }
  }

  const persistedDocument = persisted.document ?? null
  const existingDocument = existing.document ?? null
  if ((persistedDocument ?? null) !== (existingDocument ?? null)) {
    if (!persistedDocument || !existingDocument) {
      return false
    }

    if (
      !shallowEqualRecord(
        persistedDocument as unknown as UnknownRecord,
        existingDocument as unknown as UnknownRecord,
      )
    ) {
      return false
    }
  }

  const persistedFolder = persisted.folder ?? null
  const existingFolder = existing.folder ?? null
  if (persistedFolder !== existingFolder) {
    if (
      !persistedFolder ||
      !existingFolder ||
      persistedFolder.uri !== existingFolder.uri ||
      persistedFolder.rootUri !== existingFolder.rootUri ||
      persistedFolder.viewMode !== existingFolder.viewMode ||
      !areStringArraysEqual(
        persistedFolder.expandedDirectoryUris,
        existingFolder.expandedDirectoryUris,
      )
    ) {
      return false
    }
  }

  // These payloads also arrive as fresh JSON objects. Compare content while retaining
  // actual edits, including terminal binding and website session/navigation changes.
  for (const field of [
    'plugin',
    'website',
    'role',
    'terminalAgentBinding',
    'terminalGeometry',
  ] as const) {
    if (canonicalContent(persisted[field] ?? null) !== canonicalContent(existing[field] ?? null)) {
      return false
    }
  }

  return true
}

export function isNodeEquivalent(
  nextNode: Node<TerminalNodeData>,
  existingNode: Node<TerminalNodeData>,
): boolean {
  if (nextNode === existingNode) {
    return true
  }

  if (nextNode.id !== existingNode.id || nextNode.type !== existingNode.type) {
    return false
  }

  if (!isNodePositionEqual(nextNode, existingNode)) {
    return false
  }

  if (!isNodeSizeEqual(nextNode, existingNode)) {
    return false
  }

  if (!isNodeDataEquivalent(nextNode.data, existingNode.data)) {
    return false
  }

  return (
    (nextNode.dragHandle ?? null) === (existingNode.dragHandle ?? null) &&
    (nextNode.draggable ?? null) === (existingNode.draggable ?? null) &&
    (nextNode.selectable ?? null) === (existingNode.selectable ?? null) &&
    (nextNode.selected ?? null) === (existingNode.selected ?? null) &&
    (nextNode.dragging ?? null) === (existingNode.dragging ?? null)
  )
}
