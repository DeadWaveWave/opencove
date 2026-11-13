import { isNodeRevisionConflict } from './nodeMutationCommit'
import type { NodeLineageRecord } from '../../domain/nodeLineage'
import { projectNodeLineages } from '../nodeLineage/NodeLineageOwner'
import type { CreateNodeInput, CreateNodeResult } from '../../../../shared/contracts/dto'
import { createAppError, toAppErrorDescriptor } from '../../../../shared/errors/appError'
import { normalizeAgentSettings } from '../../../settings/domain/agentSettings'
import { resolveNodeCreationTarget, type ResolvedNodeCreationTarget } from './nodeCreationTarget'
import type { SpaceLocatorResolverDeps } from './spaceLocator'
import type { NodeControlRuntimeDeps } from './nodeControlUseCases'
import {
  replaceNodeControlWorkspace,
  requireNodeControlState,
  type NodeControlAppStateStore,
  type NodeControlNode,
} from './nodeControlState'
import { resolvePlacement, workspaceWithNode } from './nodeCreatePlacement'
import { resolveCreateFrame } from './nodeDataFactory'
import { toCanvasNodeDetail } from './nodeDtos'
import { assertTaskCanTakeAgent, linkAgentToTask } from './nodeTaskLink'

function targetIdentity(target: ResolvedNodeCreationTarget) {
  return JSON.stringify([
    target.workspace.id,
    target.space?.id ?? null,
    target.mount?.mountId ?? null,
    target.endpoint.endpointId,
    target.mount?.rootUri ?? null,
    target.workingDirectory,
  ])
}

/** Retry only the pure insertion plan. A process is launched once, outside this owner. */
export async function commitCreatedNode(options: {
  store: NodeControlAppStateStore
  locatorDeps: SpaceLocatorResolverDeps
  runtime: NodeControlRuntimeDeps
  input: CreateNodeInput
  node: NodeControlNode
  initialTarget: ResolvedNodeCreationTarget
  taskNodeId?: string
  now: Date
  lineage?: NodeLineageRecord | null
  callerNodeId?: string | null
}): Promise<CreateNodeResult> {
  /* eslint-disable no-await-in-loop -- Each bounded CAS attempt must use a fresh snapshot. */
  for (let attempt = 0; attempt < 3; attempt++) {
    options.runtime.assertActive?.()
    const expectedRevision = await options.store.readAppStateRevision()
    const state = requireNodeControlState(await options.store.readAppState())
    const current = await resolveNodeCreationTarget(state, options.locatorDeps, options.input)
    if (targetIdentity(current) !== targetIdentity(options.initialTarget)) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'Node creation target changed before persistence; no node was inserted.',
      })
    }
    await options.runtime.validateTarget?.(current)
    options.runtime.assertActive?.()
    if (
      state.workspaces.some(workspace => workspace.nodes.some(node => node.id === options.node.id))
    ) {
      throw createAppError('persistence.invalid_state', {
        debugMessage: 'New node identity already exists; creation was not replayed.',
      })
    }
    const placement = resolvePlacement({
      workspace: current.workspace,
      space: current.space,
      kind: options.input.kind,
      bucket: normalizeAgentSettings(state.settings).standardWindowSizeBucket,
      frame: options.input.frame,
      callerNodeId: options.callerNodeId,
    })
    const frame = resolveCreateFrame({
      kind: options.input.kind,
      size: placement.size,
      placement: placement.placement,
      frame: options.input.frame,
    })
    const node = {
      ...options.node,
      position: { x: frame.x, y: frame.y },
      width: frame.width,
      height: frame.height,
    }
    const spaceId = current.space?.id ?? null
    if (options.taskNodeId !== undefined) {
      assertTaskCanTakeAgent({
        workspace: current.workspace,
        spaceId,
        taskNodeId: options.taskNodeId,
      })
    }
    const inserted = workspaceWithNode(current.workspace, node, spaceId)
    const workspace =
      options.taskNodeId === undefined
        ? inserted
        : linkAgentToTask(inserted, {
            taskNodeId: options.taskNodeId,
            agentNodeId: node.id,
            now: options.now.toISOString(),
          })
    options.runtime.assertActive?.()
    const nextState = replaceNodeControlWorkspace(state, workspace)
    const result = options.lineage
      ? await options.store.commitCreatedNodeState!(nextState, {
          expectedRevision,
          lineage: options.lineage,
        })
      : await options.store.writeAppState(nextState, { expectedRevision })
    if (result.ok) {
      return {
        revision: result.revision ?? (await options.store.readAppStateRevision()),
        projectId: workspace.id,
        spaceId,
        node: (
          await projectNodeLineages(options.store, [
            toCanvasNodeDetail({ node, workspace, spaceId }),
          ])
        )[0],
      }
    }
    const isConflict = isNodeRevisionConflict(result.error)
    if (!isConflict || attempt === 2) {
      throw createAppError(result.error)
    }
  }
  /* eslint-enable no-await-in-loop */
  throw new Error('Node creation persistence attempts exhausted.')
}

/** An unknown write outcome must not tear down a session that may already belong to a window. */
export async function cleanupFailedNodeCreation(
  store: NodeControlAppStateStore,
  runtime: NodeControlRuntimeDeps,
  node: NodeControlNode,
  error: unknown,
): Promise<never> {
  let persisted: boolean | null = null
  try {
    const current = await store.readAppState()
    if (current) {
      persisted = current.workspaces.some(workspace =>
        workspace.nodes.some(
          item =>
            item.id === node.id &&
            item.kind === node.kind &&
            (!node.sessionId || item.sessionId === node.sessionId),
        ),
      )
    }
  } catch {
    /* An unavailable read cannot prove that the write did not commit. */
  }
  if (persisted === false && node.sessionId && store.isRuntimeReferenced) {
    try {
      persisted = store.isRuntimeReferenced(node.sessionId)
    } catch {
      persisted = null
    }
  }
  if (persisted === false) {
    if (node.sessionId) {
      try {
        await runtime.killSession(node.sessionId)
      } catch {
        /* Preserve the original persistence error. */
      }
    }
    throw error
  }
  const descriptor = toAppErrorDescriptor(error, 'persistence.io_failed')
  throw createAppError({
    ...descriptor,
    debugMessage: `${persisted ? 'The node was found in persisted state' : 'The persistence outcome could not be confirmed'}; ${node.sessionId ? 'session retained' : 'creation was not replayed'}. Inspect node ${node.id} before retrying creation. Original error: ${(descriptor.debugMessage ?? 'Node persistence failed.').slice(0, 1000)}`,
  })
}
