import type { CreateNodeInput } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { resolveSpaceMountContext } from '../../../space/application/resolveSpaceMountContext'
import { findNodeForNodeControl } from './nodeDtos'
import type { NodeControlNode } from './nodeControlState'
import type { NodeControlAppState } from './nodeControlState'
import {
  resolveSpaceLocatorForNodeControl,
  type ResolvedSpaceForNodeControl,
  type SpaceLocatorResolverDeps,
} from './spaceLocator'

export type ResolvedNodeCreationTarget = Omit<ResolvedSpaceForNodeControl, 'space'> & {
  space: ResolvedSpaceForNodeControl['space'] | null
  reference?: NodeControlNode
  referenceSpaceId?: string | null
}

export async function resolveNodeCreationTarget(
  state: NodeControlAppState,
  deps: SpaceLocatorResolverDeps,
  input: CreateNodeInput,
): Promise<ResolvedNodeCreationTarget> {
  if (input.near) {
    if (
      (input.frame !== undefined && input.frame !== null) ||
      (input.near.target === 'root-canvas' && input.space)
    ) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'near conflicts with frame or root Space locator.',
      })
    }
    const reference = findNodeForNodeControl(state.workspaces, input.near.nodeId)
    if (!reference) {
      throw createAppError('node.not_found')
    }
    if (input.projectId && reference.workspace.id !== input.projectId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'Reference belongs to another project.',
      })
    }
    const space =
      input.space ??
      (input.near.target === 'reference-container' && reference.spaceId
        ? { kind: 'spaceId' as const, spaceId: reference.spaceId }
        : null)
    const resolved = await resolveNodeCreationTarget(state, deps, {
      ...input,
      near: undefined,
      projectId: reference.workspace.id,
      space:
        space && space.kind !== 'spaceId'
          ? { ...space, projectId: space.projectId ?? reference.workspace.id }
          : space,
    })
    if (input.space && resolved.space?.id !== reference.spaceId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'Reference does not belong directly to the selected Space.',
      })
    }
    return { ...resolved, reference: reference.node, referenceSpaceId: reference.spaceId }
  }
  if (input.space) {
    const resolved = await resolveSpaceLocatorForNodeControl(state, deps, input.space)
    if (input.projectId && resolved.workspace.id !== input.projectId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'Space belongs to another project.',
      })
    }
    return resolved
  }
  const workspace = state.workspaces.find(item => item.id === input.projectId)
  if (!workspace) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create requires an explicit project or Space.',
    })
  }
  const context = resolveSpaceMountContext({
    space: null,
    workspacePath: workspace.path,
    mounts: await deps.listMounts(workspace.id),
    fallbackToFirstMount: true,
  })
  if (!context.mount) {
    throw createAppError('common.invalid_input', { debugMessage: 'Project has no default mount.' })
  }
  const endpoint = (await deps.listEndpoints()).find(
    item => item.endpointId === context.mount!.endpointId,
  )
  if (!endpoint) {
    throw createAppError('worker.unavailable')
  }
  return {
    workspace,
    space: null,
    mount: context.mount,
    workingDirectory: context.workingDirectory,
    endpoint,
  }
}
