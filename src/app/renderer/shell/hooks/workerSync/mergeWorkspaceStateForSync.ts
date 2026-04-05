import type { Node } from '@xyflow/react'
import type {
  PersistedWorkspaceState,
  SpaceArchiveRecord,
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toRuntimeNodes } from '@contexts/workspace/presentation/renderer/utils/nodeTransform'
import { isNodeGuardedFromSyncOverwrite } from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'

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
function shallowEqualRecord(left: UnknownRecord, right: UnknownRecord): boolean {
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
function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function isWorkspaceSpaceRectEqual(
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

function areSpaceArchiveRecordsEquivalent(
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
    persisted.sessionId !== existing.sessionId ||
    persisted.title !== existing.title ||
    persisted.titlePinnedByUser !== existing.titlePinnedByUser ||
    persisted.width !== existing.width ||
    persisted.height !== existing.height ||
    persisted.profileId !== existing.profileId ||
    persisted.runtimeKind !== existing.runtimeKind ||
    (persisted.labelColorOverride ?? null) !== (existing.labelColorOverride ?? null) ||
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

    if (
      !shallowEqualRecord(
        persistedTask as unknown as UnknownRecord,
        existingTask as unknown as UnknownRecord,
      )
    ) {
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

  return true
}

function isNodeEquivalent(
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

function mergeRuntimeNode(
  persistedNode: Node<TerminalNodeData>,
  existingNode: Node<TerminalNodeData> | undefined,
  workspaceHasActiveDrag: boolean,
): Node<TerminalNodeData> {
  if (!existingNode) {
    return persistedNode
  }

  if (isNodeGuardedFromSyncOverwrite(persistedNode.id)) {
    return existingNode
  }

  const isDragging = existingNode.dragging === true
  const shouldPreservePosition = workspaceHasActiveDrag || isDragging
  const persistedSessionId = persistedNode.data.sessionId.trim()
  const existingSessionId = existingNode.data.sessionId.trim()
  const kind = persistedNode.data.kind

  const nextNode: Node<TerminalNodeData> = {
    ...persistedNode,
    dragHandle: existingNode.dragHandle,
    draggable: existingNode.draggable ?? persistedNode.draggable,
    selectable: existingNode.selectable ?? persistedNode.selectable,
    selected: existingNode.selected,
    ...(shouldPreservePosition ? { position: existingNode.position } : {}),
    ...(isDragging ? { dragging: true } : {}),
    ...(existingNode.dragging === false ? { dragging: false } : {}),
    width: existingNode.width,
    height: existingNode.height,
    data: {
      ...persistedNode.data,
      sessionId: persistedSessionId.length > 0 ? persistedSessionId : existingSessionId,
      scrollback: existingNode.data.scrollback ?? persistedNode.data.scrollback,
      agent:
        kind === 'agent'
          ? (existingNode.data.agent ?? persistedNode.data.agent)
          : persistedNode.data.agent,
    },
  }

  return isNodeEquivalent(nextNode, existingNode) ? existingNode : nextNode
}

export function toShellWorkspaceStateForSync(
  workspace: PersistedWorkspaceState,
  existingWorkspace: WorkspaceState | undefined,
): WorkspaceState {
  const existingNodes = existingWorkspace?.nodes ?? []
  const workspaceHasActiveDrag = existingNodes.some(node => node.dragging === true)
  const persistedNodes = toRuntimeNodes(workspace)
  const existingNodeById = new Map(existingNodes.map(node => [node.id, node] as const))
  const persistedNodeIds = new Set(persistedNodes.map(node => node.id))

  const mergedNodeById = new Map<string, Node<TerminalNodeData>>()
  const mergedPersistedNodes = persistedNodes.map(node => {
    const mergedNode = mergeRuntimeNode(node, existingNodeById.get(node.id), workspaceHasActiveDrag)
    mergedNodeById.set(node.id, mergedNode)
    return mergedNode
  })

  const extraRuntimeNodes = existingNodes.filter(
    node => !persistedNodeIds.has(node.id) && isNodeGuardedFromSyncOverwrite(node.id),
  )

  const nodes = (() => {
    if (!existingNodes.length) {
      return [...mergedPersistedNodes, ...extraRuntimeNodes]
    }

    const orderedNodes: Array<Node<TerminalNodeData>> = []
    const usedNodeIds = new Set<string>()

    for (const node of existingNodes) {
      const merged = mergedNodeById.get(node.id)
      if (merged) {
        orderedNodes.push(merged)
        usedNodeIds.add(node.id)
        continue
      }

      if (!persistedNodeIds.has(node.id) && isNodeGuardedFromSyncOverwrite(node.id)) {
        orderedNodes.push(node)
        usedNodeIds.add(node.id)
      }
    }

    for (const node of mergedPersistedNodes) {
      if (usedNodeIds.has(node.id)) {
        continue
      }

      orderedNodes.push(node)
      usedNodeIds.add(node.id)
    }

    return orderedNodes
  })()

  const resolvedNodes =
    existingWorkspace &&
    nodes.length === existingNodes.length &&
    nodes.every((node, index) => node === existingNodes[index])
      ? existingNodes
      : nodes

  const validNodeIds = new Set(resolvedNodes.map(node => node.id))

  const existingSpaceById = new Map(
    (existingWorkspace?.spaces ?? []).map(space => [space.id, space] as const),
  )

  const mergedSpaces = workspace.spaces.map(space => {
    const existing = existingSpaceById.get(space.id) ?? null
    const persistedNodeIdSet = new Set(space.nodeIds)
    const extraNodeIds = existing
      ? existing.nodeIds.filter(
          nodeId => !persistedNodeIdSet.has(nodeId) && isNodeGuardedFromSyncOverwrite(nodeId),
        )
      : []

    const nodeIds: string[] = []
    const seenNodeIds = new Set<string>()
    const appendNodeId = (nodeId: string) => {
      if (!validNodeIds.has(nodeId) || seenNodeIds.has(nodeId)) {
        return
      }

      seenNodeIds.add(nodeId)
      nodeIds.push(nodeId)
    }

    space.nodeIds.forEach(appendNodeId)
    extraNodeIds.forEach(appendNodeId)

    if (
      existing &&
      existing.name === space.name &&
      existing.directoryPath === space.directoryPath &&
      existing.labelColor === space.labelColor &&
      isWorkspaceSpaceRectEqual(existing.rect, space.rect) &&
      areStringArraysEqual(existing.nodeIds, nodeIds)
    ) {
      return existing
    }

    return {
      ...space,
      nodeIds,
    } satisfies WorkspaceSpaceState
  })

  const existingSpaces = existingWorkspace?.spaces ?? []
  const sanitizedSpaces =
    existingWorkspace &&
    mergedSpaces.length === existingSpaces.length &&
    mergedSpaces.every((space, index) => space === existingSpaces[index])
      ? existingSpaces
      : mergedSpaces

  const hasActiveSpace =
    workspace.activeSpaceId !== null &&
    sanitizedSpaces.some(space => space.id === workspace.activeSpaceId)

  const existingActiveSpaceId = existingWorkspace?.activeSpaceId ?? null
  const resolvedActiveSpaceId =
    existingActiveSpaceId && sanitizedSpaces.some(space => space.id === existingActiveSpaceId)
      ? existingActiveSpaceId
      : hasActiveSpace
        ? workspace.activeSpaceId
        : null

  const pullRequestBaseBranchOptions = (() => {
    const existing = existingWorkspace?.pullRequestBaseBranchOptions ?? null
    const next = workspace.pullRequestBaseBranchOptions ?? []
    if (!existing || !areStringArraysEqual(existing, next)) {
      return next
    }

    return existing
  })()

  const viewport = (() => {
    const nextViewport = {
      x: existingWorkspace?.viewport.x ?? workspace.viewport.x,
      y: existingWorkspace?.viewport.y ?? workspace.viewport.y,
      zoom: existingWorkspace?.viewport.zoom ?? workspace.viewport.zoom,
    }

    if (
      existingWorkspace &&
      existingWorkspace.viewport.x === nextViewport.x &&
      existingWorkspace.viewport.y === nextViewport.y &&
      existingWorkspace.viewport.zoom === nextViewport.zoom
    ) {
      return existingWorkspace.viewport
    }

    return nextViewport
  })()

  const nextSpaceArchiveRecords = workspace.spaceArchiveRecords
  const spaceArchiveRecords =
    existingWorkspace &&
    areSpaceArchiveRecordsEquivalent(existingWorkspace.spaceArchiveRecords, nextSpaceArchiveRecords)
      ? existingWorkspace.spaceArchiveRecords
      : nextSpaceArchiveRecords

  const nextWorkspace: WorkspaceState = {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    worktreesRoot: workspace.worktreesRoot,
    pullRequestBaseBranchOptions,
    nodes: resolvedNodes,
    viewport,
    isMinimapVisible: existingWorkspace?.isMinimapVisible ?? workspace.isMinimapVisible,
    spaces: sanitizedSpaces,
    activeSpaceId: resolvedActiveSpaceId,
    spaceArchiveRecords,
  }

  if (
    existingWorkspace &&
    existingWorkspace.name === nextWorkspace.name &&
    existingWorkspace.path === nextWorkspace.path &&
    existingWorkspace.worktreesRoot === nextWorkspace.worktreesRoot &&
    areStringArraysEqual(
      existingWorkspace.pullRequestBaseBranchOptions ?? [],
      nextWorkspace.pullRequestBaseBranchOptions ?? [],
    ) &&
    existingWorkspace.nodes === nextWorkspace.nodes &&
    existingWorkspace.viewport === nextWorkspace.viewport &&
    existingWorkspace.isMinimapVisible === nextWorkspace.isMinimapVisible &&
    existingWorkspace.spaces === nextWorkspace.spaces &&
    existingWorkspace.activeSpaceId === nextWorkspace.activeSpaceId &&
    existingWorkspace.spaceArchiveRecords === nextWorkspace.spaceArchiveRecords
  ) {
    return existingWorkspace
  }

  return nextWorkspace
}
