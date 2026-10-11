import { createAppError } from '../../../../shared/errors/appError'
import type {
  CreateNodeInput,
  CreateNodeResult,
  GetNodeInput,
  GetNodeResult,
  ListNodesInput,
  ListNodesResult,
} from '../../../../shared/contracts/dto'
import {
  requireNodeControlState,
  type NodeControlAppStateStore,
  type NodeControlNode,
} from './nodeControlState'
import { resolveNodeCreationTarget, type ResolvedNodeCreationTarget } from './nodeCreationTarget'
import { normalizeAgentSettings } from '../../../settings/domain/agentSettings'
import { resolvePlacement } from './nodeCreatePlacement'
import { commitCreatedNode, cleanupFailedNodeCreation } from './nodeCreateCommit'
import {
  listSpacesForNodeControl,
  resolveSpaceLocatorForNodeControl,
  type SpaceLocatorResolverDeps,
} from './spaceLocator'
import {
  findNodeForNodeControl,
  isReadableNodeKind,
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
  assertActive?: () => void
  validateTarget?: (target: ResolvedNodeCreationTarget) => Promise<void>
  launchAgent: (
    resolved: ResolvedNodeCreationTarget,
    data: Extract<NodeControlCreateData, { kind: 'agent' }>,
  ) => Promise<AgentNodeRuntimeData>
  spawnTerminal: (
    resolved: ResolvedNodeCreationTarget,
    data: Extract<NodeControlCreateData, { kind: 'terminal' }>,
  ) => Promise<TerminalNodeRuntimeData>
  killSession: (sessionId: string) => Promise<void> | void
  closePluginNode?: (nodeId: string) => Promise<void> | void
  closeWebsiteNode?: (nodeId: string) => Promise<void> | void
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
        .filter((node): node is NodeControlNode => !!node && isReadableNodeKind(node.kind))
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
        .filter(node => isReadableNodeKind(node.kind))
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
  const resolved = await resolveNodeCreationTarget(state, options.locatorDeps, options.input)
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

  await options.runtime.validateTarget?.(resolved)
  options.runtime.assertActive?.()
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
    return await commitCreatedNode({ ...options, node, initialTarget: resolved })
  } catch (error) {
    return cleanupFailedNodeCreation(options.store, options.runtime, node, error)
  }
}
