import type { Node } from '@xyflow/react'
import type {
  PersistedWorkspaceState,
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toRuntimeNodes } from '@contexts/workspace/presentation/renderer/utils/nodeTransform'
import { isNodeGuardedFromSyncOverwrite } from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import { repairRuntimeNodeFrame } from '../runtimeNodeFrameRepair'
import {
  areSpaceArchiveRecordsEquivalent,
  areStringArraysEqual,
  isNodeEquivalent,
  isWorkspaceSpaceRectEqual,
  shallowEqualRecord,
} from './mergeWorkspaceStateForSync.equality'

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
  const runtimeSessionId =
    persistedSessionId.length > 0
      ? persistedSessionId
      : existingSessionId.length > 0
        ? existingSessionId
        : ''
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
      sessionId: runtimeSessionId,
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
  const persistedNodes = toRuntimeNodes(workspace).map(repairRuntimeNodeFrame)
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

  const environmentVariables = (() => {
    const existing = existingWorkspace?.environmentVariables ?? undefined
    const next = workspace.environmentVariables ?? undefined
    if (!existing && !next) {
      return undefined
    }

    if (
      existing &&
      next &&
      shallowEqualRecord(existing as Record<string, string>, next as Record<string, string>)
    ) {
      return existing
    }

    return next
  })()

  const nextWorkspace: WorkspaceState = {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    worktreesRoot: workspace.worktreesRoot,
    pullRequestBaseBranchOptions,
    environmentVariables,
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
    existingWorkspace.environmentVariables === nextWorkspace.environmentVariables &&
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
