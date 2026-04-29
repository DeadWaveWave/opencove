import type {
  CreateNodeInput,
  CreateNodeResult,
  GetNodeInput,
  GetNodeResult,
  ListNodesInput,
  ListNodesResult,
  ManagedCanvasNodeKind,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import {
  persistNodeControlState,
  replaceNodeControlWorkspace,
  requireNodeControlState,
  type NodeControlAppStateStore,
  type NodeControlNode,
  type NodeControlSpace,
  type NodeControlWorkspace,
} from './nodeControlState'
import { normalizeAgentSettings } from '../../../settings/domain/agentSettings'
import {
  resolveCanonicalNodeSize,
  type WorkspaceCanonicalSizeBucket,
} from '../../domain/workspaceNodeSizing'
import { computeSpaceRectFromNodes, SPACE_NODE_PADDING } from '../../domain/workspaceSpaceLayout'
import { resolveWorkspaceNodesPlacement } from '../../domain/workspaceNodePlacement'
import {
  listSpacesForNodeControl,
  resolveSpaceLocatorForNodeControl,
  type ResolvedSpaceForNodeControl,
  type SpaceLocatorResolverDeps,
} from './spaceLocator'
import {
  findNodeForNodeControl,
  isManagedNodeKind,
  toCanvasNodeDetail,
  toCanvasNodeSummary,
} from './nodeDtos'
import {
  makeNode,
  normalizeCreateNodeData,
  resolveCreateFrame,
  resolveNodeTitle,
  type AgentNodeRuntimeData,
  type NodeControlCreateData,
  type TerminalNodeRuntimeData,
} from './nodeDataFactory'

export interface NodeControlRuntimeDeps {
  launchAgent: (
    resolved: ResolvedSpaceForNodeControl,
    data: Extract<NodeControlCreateData, { kind: 'agent' }>,
  ) => Promise<AgentNodeRuntimeData>
  spawnTerminal: (
    resolved: ResolvedSpaceForNodeControl,
    data: Extract<NodeControlCreateData, { kind: 'terminal' }>,
  ) => Promise<TerminalNodeRuntimeData>
  killSession: (sessionId: string) => Promise<void> | void
  closeWebsiteNode?: (nodeId: string) => Promise<void> | void
}

function workspaceWithNode(
  workspace: NodeControlWorkspace,
  node: NodeControlNode,
  spaceId: string,
): NodeControlWorkspace {
  const nodeRect = {
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
  }

  const nextSpaces = workspace.spaces.map(space => {
    const filtered = space.nodeIds.filter(nodeId => nodeId !== node.id)
    if (space.id !== spaceId) {
      return { ...space, nodeIds: filtered }
    }

    const rect = expandSpaceRect(space.rect, nodeRect)
    return { ...space, nodeIds: [...filtered, node.id], rect }
  })

  return {
    ...workspace,
    nodes: [...workspace.nodes, node],
    spaces: nextSpaces,
  }
}

function expandSpaceRect(
  current: NodeControlSpace['rect'],
  node: { x: number; y: number; width: number; height: number },
): NodeControlSpace['rect'] {
  if (!current) {
    return computeSpaceRectFromNodes([node])
  }

  const left = Math.min(current.x, node.x - SPACE_NODE_PADDING)
  const top = Math.min(current.y, node.y - SPACE_NODE_PADDING)
  const right = Math.max(current.x + current.width, node.x + node.width + SPACE_NODE_PADDING)
  const bottom = Math.max(current.y + current.height, node.y + node.height + SPACE_NODE_PADDING)

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function resolveSpaceRect(
  workspace: NodeControlWorkspace,
  space: NodeControlSpace,
): { x: number; y: number; width: number; height: number } | null {
  if (space.rect) {
    return space.rect
  }

  const nodeById = new Map(workspace.nodes.map(node => [node.id, node]))
  const ownedNodes = space.nodeIds
    .map(nodeId => nodeById.get(nodeId))
    .filter((node): node is NodeControlNode => Boolean(node))
  if (ownedNodes.length === 0) {
    return null
  }

  return computeSpaceRectFromNodes(
    ownedNodes.map(node => ({
      x: node.position.x,
      y: node.position.y,
      width: node.width,
      height: node.height,
    })),
  )
}

function resolvePlacement(options: {
  workspace: NodeControlWorkspace
  space: NodeControlSpace
  kind: ManagedCanvasNodeKind
  bucket: WorkspaceCanonicalSizeBucket
  frame?: CreateNodeInput['frame']
}): { placement: { x: number; y: number }; size: { width: number; height: number } } {
  const defaultSize = resolveCanonicalNodeSize({ kind: options.kind, bucket: options.bucket })
  const explicitX =
    typeof options.frame?.x === 'number' && Number.isFinite(options.frame.x)
      ? options.frame.x
      : null
  const explicitY =
    typeof options.frame?.y === 'number' && Number.isFinite(options.frame.y)
      ? options.frame.y
      : null

  if (explicitX !== null && explicitY !== null) {
    return { placement: { x: explicitX, y: explicitY }, size: defaultSize }
  }

  const targetSpaceRect = resolveSpaceRect(options.workspace, options.space)
  const anchor = targetSpaceRect
    ? { x: targetSpaceRect.x + SPACE_NODE_PADDING, y: targetSpaceRect.y + SPACE_NODE_PADDING }
    : { x: 0, y: 0 }
  const spaceRects = options.workspace.spaces
    .map(space => space.rect)
    .filter((rect): rect is { x: number; y: number; width: number; height: number } =>
      Boolean(rect),
    )
  const resolved = resolveWorkspaceNodesPlacement({
    anchor,
    size: defaultSize,
    nodes: options.workspace.nodes.map(node => ({
      id: node.id,
      position: node.position,
      data: { width: node.width, height: node.height },
    })),
    spaceRects,
    targetSpaceRect,
  })

  if (!resolved.canPlace) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create could not find an available canvas slot.',
    })
  }

  return { placement: resolved.placement, size: defaultSize }
}

export async function listNodesForNodeControl(options: {
  store: NodeControlAppStateStore
  locatorDeps: SpaceLocatorResolverDeps
  input: ListNodesInput
}): Promise<ListNodesResult> {
  const state = requireNodeControlState(await options.store.readAppState())
  const kind = options.input.kind ?? null

  if (options.input.space) {
    const resolved = await resolveSpaceLocatorForNodeControl(
      state,
      options.locatorDeps,
      options.input.space,
    )
    const nodeById = new Map(resolved.workspace.nodes.map(node => [node.id, node]))
    return {
      projectId: resolved.workspace.id,
      spaceId: resolved.space.id,
      nodes: resolved.space.nodeIds
        .map(nodeId => nodeById.get(nodeId))
        .filter((node): node is NodeControlNode => !!node && isManagedNodeKind(node.kind))
        .filter(node => !kind || node.kind === kind)
        .map(node =>
          toCanvasNodeSummary({
            node,
            workspace: resolved.workspace,
            spaceId: resolved.space.id,
          }),
        ),
    }
  }

  const projectId = options.input.projectId ?? state.activeWorkspaceId ?? null
  const spaces = await listSpacesForNodeControl(state, options.locatorDeps, projectId)
  const spaceByNodeId = new Map<string, string>()
  for (const resolved of spaces) {
    for (const nodeId of resolved.space.nodeIds) {
      spaceByNodeId.set(nodeId, resolved.space.id)
    }
  }

  const workspaces = projectId
    ? state.workspaces.filter(workspace => workspace.id === projectId)
    : state.workspaces
  return {
    projectId,
    spaceId: null,
    nodes: workspaces.flatMap(workspace =>
      workspace.nodes
        .filter(node => isManagedNodeKind(node.kind))
        .filter(node => !kind || node.kind === kind)
        .map(node =>
          toCanvasNodeSummary({ node, workspace, spaceId: spaceByNodeId.get(node.id) ?? null }),
        ),
    ),
  }
}

export async function getNodeForNodeControl(options: {
  store: NodeControlAppStateStore
  input: GetNodeInput
}): Promise<GetNodeResult> {
  const state = requireNodeControlState(await options.store.readAppState())
  const matched = findNodeForNodeControl(state.workspaces, options.input.nodeId)
  if (!matched) {
    throw createAppError('node.not_found')
  }

  return { node: toCanvasNodeDetail(matched) }
}

export async function createNodeForNodeControl(options: {
  store: NodeControlAppStateStore
  locatorDeps: SpaceLocatorResolverDeps
  runtime: NodeControlRuntimeDeps
  input: CreateNodeInput
  now: Date
}): Promise<CreateNodeResult> {
  const state = requireNodeControlState(await options.store.readAppState())
  const resolved = await resolveSpaceLocatorForNodeControl(
    state,
    options.locatorDeps,
    options.input.space,
  )
  const createData = normalizeCreateNodeData(options.input.kind, options.input.data)
  const settings = normalizeAgentSettings(state.settings)
  const placement = resolvePlacement({
    workspace: resolved.workspace,
    space: resolved.space,
    kind: options.input.kind,
    bucket: settings.standardWindowSizeBucket,
    frame: options.input.frame,
  })
  const frame = resolveCreateFrame({
    kind: options.input.kind,
    size: placement.size,
    placement: placement.placement,
    frame: options.input.frame,
  })

  let agentRuntime: AgentNodeRuntimeData | null = null
  let terminalRuntime: TerminalNodeRuntimeData | null = null
  if (createData.kind === 'agent') {
    agentRuntime = await options.runtime.launchAgent(resolved, createData)
  } else if (createData.kind === 'terminal') {
    terminalRuntime = await options.runtime.spawnTerminal(resolved, createData)
  }

  const node = makeNode({
    kind: options.input.kind,
    title: resolveNodeTitle({
      kind: options.input.kind,
      title: options.input.title,
      data: createData,
      agentRuntime,
    }),
    frame,
    data: createData,
    now: options.now.toISOString(),
    agentRuntime,
    terminalRuntime,
  })

  try {
    const nextWorkspace = workspaceWithNode(resolved.workspace, node, resolved.space.id)
    const nextState = replaceNodeControlWorkspace(state, nextWorkspace)
    const revision = await persistNodeControlState(options.store, nextState)
    return {
      revision,
      projectId: resolved.workspace.id,
      spaceId: resolved.space.id,
      node: toCanvasNodeDetail({ node, workspace: nextWorkspace, spaceId: resolved.space.id }),
    }
  } catch (error) {
    if (node.sessionId) {
      await Promise.resolve(options.runtime.killSession(node.sessionId)).catch(() => undefined)
    }
    throw error
  }
}
