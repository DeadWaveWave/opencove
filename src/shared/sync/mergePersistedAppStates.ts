import type {
  PersistedAppState,
  PersistedTerminalNode,
  PersistedWorkspaceState,
  TaskNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'

export function isPersistedAppState(value: unknown): value is PersistedAppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.formatVersion === 'number' &&
    Array.isArray(record.workspaces) &&
    typeof record.settings === 'object' &&
    record.settings !== null
  )
}

function mergeSnapshotField<T>(
  baseValue: T,
  localValue: T,
  snapshotValue: T | undefined,
  equals: (left: T, right: T) => boolean,
): T {
  if (snapshotValue === undefined) {
    return localValue
  }

  const baseChanged = !equals(baseValue, snapshotValue)
  const localChanged = !equals(localValue, snapshotValue)

  if (localChanged && !baseChanged) {
    return localValue
  }

  if (!localChanged && baseChanged) {
    return baseValue
  }

  if (!localChanged && !baseChanged) {
    return baseValue
  }

  return localValue
}

function mergeNodes(
  baseNodes: PersistedTerminalNode[],
  localNodes: PersistedTerminalNode[],
  baseSnapshotNodes: PersistedTerminalNode[] | null,
  deletedNodeIds: Set<string>,
): PersistedTerminalNode[] {
  const localById = new Map(localNodes.map(node => [node.id, node] as const))
  const snapshotById = new Map((baseSnapshotNodes ?? []).map(node => [node.id, node] as const))
  const seen = new Set<string>()
  const merged: PersistedTerminalNode[] = []

  function isTaskNodeData(value: unknown): value is TaskNodeData {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (() => {
        const record = value as Record<string, unknown>
        return (
          typeof record.requirement === 'string' &&
          typeof record.status === 'string' &&
          typeof record.priority === 'string' &&
          Array.isArray(record.tags) &&
          Array.isArray(record.agentSessions)
        )
      })()
    )
  }

  function normalizeLinkedAgentNodeId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null
    }

    const normalized = value.trim()
    return normalized.length > 0 ? normalized : null
  }

  function isPointEqual(
    left: PersistedTerminalNode['position'],
    right: PersistedTerminalNode['position'],
  ): boolean {
    if (left === right) {
      return true
    }

    return left.x === right.x && left.y === right.y
  }

  for (const baseNode of baseNodes) {
    if (deletedNodeIds.has(baseNode.id)) {
      seen.add(baseNode.id)
      continue
    }

    const localNode = localById.get(baseNode.id)
    if (!localNode) {
      merged.push(baseNode)
      seen.add(baseNode.id)
      continue
    }

    const snapshotNode = snapshotById.get(baseNode.id)
    if (!snapshotNode) {
      merged.push(localNode)
      seen.add(baseNode.id)
      continue
    }

    const task = (() => {
      if (baseNode.kind !== 'task' || localNode.kind !== 'task' || snapshotNode.kind !== 'task') {
        return localNode.task
      }

      if (!isTaskNodeData(baseNode.task) || !isTaskNodeData(localNode.task)) {
        return localNode.task
      }

      const snapshotTask = isTaskNodeData(snapshotNode.task) ? snapshotNode.task : null
      if (!snapshotTask) {
        return localNode.task
      }

      const baseLinkedAgentNodeId = normalizeLinkedAgentNodeId(baseNode.task.linkedAgentNodeId)
      const localLinkedAgentNodeId = normalizeLinkedAgentNodeId(localNode.task.linkedAgentNodeId)
      const snapshotLinkedAgentNodeId = normalizeLinkedAgentNodeId(snapshotTask.linkedAgentNodeId)

      const mergedLinkedAgentNodeId = mergeSnapshotField(
        baseLinkedAgentNodeId,
        localLinkedAgentNodeId,
        snapshotLinkedAgentNodeId,
        (left, right) => left === right,
      )

      if (mergedLinkedAgentNodeId === localLinkedAgentNodeId) {
        return localNode.task
      }

      return {
        ...localNode.task,
        linkedAgentNodeId: mergedLinkedAgentNodeId,
      }
    })()

    merged.push({
      ...localNode,
      position: mergeSnapshotField(
        baseNode.position,
        localNode.position,
        snapshotNode.position,
        isPointEqual,
      ),
      width: mergeSnapshotField(
        baseNode.width,
        localNode.width,
        snapshotNode.width,
        (left, right) => left === right,
      ),
      height: mergeSnapshotField(
        baseNode.height,
        localNode.height,
        snapshotNode.height,
        (left, right) => left === right,
      ),
      task,
    })
    seen.add(baseNode.id)
  }

  for (const localNode of localNodes) {
    if (deletedNodeIds.has(localNode.id)) {
      continue
    }

    if (seen.has(localNode.id)) {
      continue
    }

    merged.push(localNode)
  }

  return merged
}

function mergeSpaces(options: {
  baseSpaces: WorkspaceSpaceState[]
  localSpaces: WorkspaceSpaceState[]
  baseSnapshotSpaces: WorkspaceSpaceState[] | null
  validNodeIds: Set<string>
}): WorkspaceSpaceState[] {
  const localSpaceById = new Map(options.localSpaces.map(space => [space.id, space] as const))
  const snapshotSpaceById = new Map(
    (options.baseSnapshotSpaces ?? []).map(space => [space.id, space] as const),
  )
  const baseSpaceIds = new Set(options.baseSpaces.map(space => space.id))
  const deletedSpaceIds = new Set<string>()

  if (options.baseSnapshotSpaces) {
    const localSpaceIds = new Set(options.localSpaces.map(space => space.id))
    for (const snapshotSpace of options.baseSnapshotSpaces) {
      if (!baseSpaceIds.has(snapshotSpace.id) || !localSpaceIds.has(snapshotSpace.id)) {
        deletedSpaceIds.add(snapshotSpace.id)
      }
    }
  }
  const assignmentByNodeId = new Map<string, string>()

  function isSpaceRectEqual(left: WorkspaceSpaceState['rect'], right: WorkspaceSpaceState['rect']) {
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

  for (const space of options.baseSpaces) {
    if (deletedSpaceIds.has(space.id)) {
      continue
    }
    for (const nodeId of space.nodeIds) {
      if (!options.validNodeIds.has(nodeId)) {
        continue
      }

      if (!assignmentByNodeId.has(nodeId)) {
        assignmentByNodeId.set(nodeId, space.id)
      }
    }
  }

  for (const space of options.localSpaces) {
    if (deletedSpaceIds.has(space.id)) {
      continue
    }
    for (const nodeId of space.nodeIds) {
      if (!options.validNodeIds.has(nodeId)) {
        continue
      }

      assignmentByNodeId.set(nodeId, space.id)
    }
  }

  const mergedSpaces: WorkspaceSpaceState[] = []

  for (const baseSpace of options.baseSpaces) {
    if (deletedSpaceIds.has(baseSpace.id)) {
      continue
    }
    const localSpace = localSpaceById.get(baseSpace.id) ?? null
    const snapshotSpace = snapshotSpaceById.get(baseSpace.id)

    const baseOrder = baseSpace.nodeIds.filter(
      nodeId => assignmentByNodeId.get(nodeId) === baseSpace.id && options.validNodeIds.has(nodeId),
    )
    const localOrder = localSpace
      ? localSpace.nodeIds.filter(
          nodeId =>
            assignmentByNodeId.get(nodeId) === baseSpace.id &&
            options.validNodeIds.has(nodeId) &&
            !baseOrder.includes(nodeId),
        )
      : []

    const nodeIds = [...new Set([...baseOrder, ...localOrder])]

    if (!localSpace) {
      mergedSpaces.push({ ...baseSpace, nodeIds })
      continue
    }

    const mergedSpace: WorkspaceSpaceState = {
      ...baseSpace,
      name: mergeSnapshotField(
        baseSpace.name,
        localSpace.name,
        snapshotSpace?.name,
        (left, right) => left === right,
      ),
      directoryPath: mergeSnapshotField(
        baseSpace.directoryPath,
        localSpace.directoryPath,
        snapshotSpace?.directoryPath,
        (left, right) => left === right,
      ),
      targetMountId: mergeSnapshotField(
        baseSpace.targetMountId,
        localSpace.targetMountId,
        snapshotSpace?.targetMountId,
        (left, right) => left === right,
      ),
      labelColor: mergeSnapshotField(
        baseSpace.labelColor,
        localSpace.labelColor,
        snapshotSpace?.labelColor,
        (left, right) => left === right,
      ),
      rect: mergeSnapshotField(
        baseSpace.rect,
        localSpace.rect,
        snapshotSpace?.rect,
        isSpaceRectEqual,
      ),
      nodeIds,
    }

    mergedSpaces.push(mergedSpace)
  }

  for (const localSpace of options.localSpaces) {
    if (deletedSpaceIds.has(localSpace.id)) {
      continue
    }
    if (baseSpaceIds.has(localSpace.id)) {
      continue
    }

    const nodeIds = [
      ...new Set(
        localSpace.nodeIds.filter(
          nodeId =>
            assignmentByNodeId.get(nodeId) === localSpace.id && options.validNodeIds.has(nodeId),
        ),
      ),
    ]

    mergedSpaces.push({ ...localSpace, nodeIds })
  }

  if (mergedSpaces.length === 0) {
    return mergedSpaces
  }

  const knownSpaceIds = new Set(mergedSpaces.map(space => space.id))
  const orphanNodeIds: string[] = []

  for (const [nodeId, spaceId] of assignmentByNodeId.entries()) {
    if (!knownSpaceIds.has(spaceId)) {
      orphanNodeIds.push(nodeId)
    }
  }

  if (orphanNodeIds.length === 0) {
    return mergedSpaces
  }

  const first = mergedSpaces[0]
  mergedSpaces[0] = {
    ...first,
    nodeIds: [...new Set([...first.nodeIds, ...orphanNodeIds])],
  }

  return mergedSpaces
}

function mergeWorkspaces(
  base: PersistedWorkspaceState,
  local: PersistedWorkspaceState,
  baseSnapshotWorkspace: PersistedWorkspaceState | null,
): PersistedWorkspaceState {
  const deletedNodeIds = new Set<string>()

  if (baseSnapshotWorkspace) {
    const snapshotNodeIds = new Set(baseSnapshotWorkspace.nodes.map(node => node.id))
    const baseNodeIds = new Set(base.nodes.map(node => node.id))
    const localNodeIds = new Set(local.nodes.map(node => node.id))

    for (const nodeId of snapshotNodeIds) {
      if (!baseNodeIds.has(nodeId) || !localNodeIds.has(nodeId)) {
        deletedNodeIds.add(nodeId)
      }
    }
  }

  const nodes = mergeNodes(
    base.nodes,
    local.nodes,
    baseSnapshotWorkspace?.nodes ?? null,
    deletedNodeIds,
  )
  const validNodeIds = new Set(nodes.map(node => node.id))

  return {
    ...base,
    ...local,
    nodes,
    spaces: mergeSpaces({
      baseSpaces: base.spaces,
      localSpaces: local.spaces,
      baseSnapshotSpaces: baseSnapshotWorkspace?.spaces ?? null,
      validNodeIds,
    }),
    viewport: base.viewport,
    isMinimapVisible: base.isMinimapVisible,
    activeSpaceId: base.activeSpaceId,
  }
}

export function mergePersistedAppStates(
  base: PersistedAppState,
  local: PersistedAppState,
  baseSnapshot: PersistedAppState | null = null,
): PersistedAppState {
  const baseSnapshotWorkspaceById = new Map(
    (baseSnapshot?.workspaces ?? []).map(workspace => [workspace.id, workspace] as const),
  )
  const localWorkspaceById = new Map(
    local.workspaces.map(workspace => [workspace.id, workspace] as const),
  )
  const baseWorkspaceIds = new Set(base.workspaces.map(workspace => workspace.id))

  const mergedWorkspaces = base.workspaces.map(workspace => {
    const localWorkspace = localWorkspaceById.get(workspace.id)
    return localWorkspace
      ? mergeWorkspaces(
          workspace,
          localWorkspace,
          baseSnapshotWorkspaceById.get(workspace.id) ?? null,
        )
      : workspace
  })

  for (const localWorkspace of local.workspaces) {
    if (baseWorkspaceIds.has(localWorkspace.id)) {
      continue
    }

    mergedWorkspaces.push(localWorkspace)
  }

  return {
    ...base,
    ...local,
    activeWorkspaceId: base.activeWorkspaceId,
    workspaces: mergedWorkspaces,
  }
}
