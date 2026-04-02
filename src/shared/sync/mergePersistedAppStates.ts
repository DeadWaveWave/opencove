import type {
  PersistedAppState,
  PersistedTerminalNode,
  PersistedWorkspaceState,
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

function mergeNodes(
  baseNodes: PersistedTerminalNode[],
  localNodes: PersistedTerminalNode[],
  deletedNodeIds: Set<string>,
): PersistedTerminalNode[] {
  const localById = new Map(localNodes.map(node => [node.id, node] as const))
  const seen = new Set<string>()
  const merged: PersistedTerminalNode[] = []

  for (const baseNode of baseNodes) {
    if (deletedNodeIds.has(baseNode.id)) {
      seen.add(baseNode.id)
      continue
    }

    merged.push(localById.get(baseNode.id) ?? baseNode)
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
  validNodeIds: Set<string>
}): WorkspaceSpaceState[] {
  const localSpaceById = new Map(options.localSpaces.map(space => [space.id, space] as const))
  const baseSpaceIds = new Set(options.baseSpaces.map(space => space.id))
  const assignmentByNodeId = new Map<string, string>()

  for (const space of options.baseSpaces) {
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
    for (const nodeId of space.nodeIds) {
      if (!options.validNodeIds.has(nodeId)) {
        continue
      }

      assignmentByNodeId.set(nodeId, space.id)
    }
  }

  const mergedSpaces: WorkspaceSpaceState[] = []

  for (const baseSpace of options.baseSpaces) {
    const localSpace = localSpaceById.get(baseSpace.id) ?? null

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
    mergedSpaces.push({
      ...(localSpace ? { ...baseSpace, ...localSpace } : baseSpace),
      nodeIds,
    })
  }

  for (const localSpace of options.localSpaces) {
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

  const nodes = mergeNodes(base.nodes, local.nodes, deletedNodeIds)
  const validNodeIds = new Set(nodes.map(node => node.id))

  return {
    ...base,
    ...local,
    nodes,
    spaces: mergeSpaces({ baseSpaces: base.spaces, localSpaces: local.spaces, validNodeIds }),
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
