import type {
  AgentSpawnAdmissionOwner,
  AgentSpawnPermit,
  GrantCreationAuthority,
} from '../nodeSpawn/AgentSpawnAdmissionOwner'
import { prepareNodeLineage, projectNodeLineages } from '../nodeLineage/NodeLineageOwner'
import { randomUUID } from 'node:crypto'
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
  cleanupUncommittedSpawn?: (nodeId: string) => Promise<void>
  withSpawnPermit?: <T>(permit: AgentSpawnPermit, execute: () => Promise<T>) => Promise<T>
  assertActive?: () => void
  validateTarget?: (target: ResolvedNodeCreationTarget) => Promise<void>
  launchAgent: (
    resolved: ResolvedNodeCreationTarget & { canvasNodeId?: string },
    data: Extract<NodeControlCreateData, { kind: 'agent' }>,
  ) => Promise<AgentNodeRuntimeData>
  spawnTerminal: (
    resolved: ResolvedNodeCreationTarget & { canvasNodeId?: string },
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
      nodes: await projectNodeLineages(
        options.store,
        resolved.space.nodeIds
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
        options.input.spawnedByNodeId,
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
    nodes: await projectNodeLineages(
      options.store,
      workspaces.flatMap(workspace =>
        workspace.nodes
          .filter(node => isReadableNodeKind(node.kind))
          .filter(node => !kind || node.kind === kind)
          .map(node =>
            toCanvasNodeSummary({ node, workspace, spaceId: spaceByNodeId.get(node.id) ?? null }),
          ),
      ),
      options.input.spawnedByNodeId,
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

  return { node: (await projectNodeLineages(options.store, [toCanvasNodeDetail(matched)]))[0] }
}

export async function createNodeForNodeControl(options: {
  store: NodeControlAppStateStore
  locatorDeps: SpaceLocatorResolverDeps
  runtime: NodeControlRuntimeDeps
  input: CreateNodeInput
  now: Date
  /** Internal identity from an authenticated session grant, never a wire field. */
  callerNodeId?: string | null
  authority?: GrantCreationAuthority
  admission?: AgentSpawnAdmissionOwner
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
    callerNodeId: options.callerNodeId,
  })
  const frame = resolveCreateFrame({
    kind: options.input.kind,
    size: placement.size,
    placement: placement.placement,
    frame: options.input.frame,
  })

  await options.runtime.validateTarget?.(resolved)
  options.runtime.assertActive?.()
  const canvasNodeId = randomUUID()
  if (options.authority && (createData.kind === 'agent' || createData.kind === 'terminal')) {
    if (!options.store.nodeLineage || !options.store.commitCreatedNodeState) {
      throw createAppError('persistence.unavailable')
    }
    if (!options.admission || !options.runtime.withSpawnPermit) {
      throw createAppError('common.unavailable')
    }
    return options.admission.runCreation(
      options.store,
      {
        authority: options.authority,
        nodeId: canvasNodeId,
        title: options.input.title ?? undefined,
        kind: createData.kind,
        target: resolved,
        assertActive: () => options.runtime.assertActive?.(),
      },
      (permit, lineage) => options.runtime.withSpawnPermit!(permit, () => create(lineage)),
    )
  }
  if (createData.kind !== 'agent' && createData.kind !== 'terminal') {
    options.admission?.noteNonRuntimeCreation(canvasNodeId)
  }
  return create(await prepareNodeLineage(options.store, canvasNodeId, options.callerNodeId))

  async function create(
    lineage: import('../../domain/nodeLineage').NodeLineageRecord | null,
  ): Promise<CreateNodeResult> {
    options.runtime.assertActive?.()
    const spawnTarget = { ...resolved, canvasNodeId }
    let agentRuntime: AgentNodeRuntimeData | null = null
    let terminalRuntime: TerminalNodeRuntimeData | null = null
    let node: NodeControlNode
    try {
      if (createData.kind === 'agent') {
        agentRuntime = await options.runtime.launchAgent(spawnTarget, createData)
      } else if (createData.kind === 'terminal') {
        terminalRuntime = await options.runtime.spawnTerminal(spawnTarget, createData)
      }
      node = makeNode({
        id: canvasNodeId,
        titlePinnedByUser:
          (options.input.kind === 'agent' || options.input.kind === 'terminal') &&
          Boolean(options.input.title?.trim()),
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
    } catch (error) {
      await options.runtime.cleanupUncommittedSpawn?.(canvasNodeId)
      throw error
    }
    try {
      return await commitCreatedNode({ ...options, node, lineage, initialTarget: resolved })
    } catch (error) {
      return cleanupFailedNodeCreation(options.store, options.runtime, node, error)
    }
  }
}
