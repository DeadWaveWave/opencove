import type { CreateNodeInput } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { resolveSpaceMountContext } from '../../../space/application/resolveSpaceMountContext'
import type { NodeControlAppState } from './nodeControlState'
import {
  resolveSpaceLocatorForNodeControl,
  type ResolvedSpaceForNodeControl,
  type SpaceLocatorResolverDeps,
} from './spaceLocator'

export type ResolvedNodeCreationTarget = Omit<ResolvedSpaceForNodeControl, 'space'> & {
  space: ResolvedSpaceForNodeControl['space'] | null
}

export async function resolveNodeCreationTarget(
  state: NodeControlAppState,
  deps: SpaceLocatorResolverDeps,
  input: CreateNodeInput,
): Promise<ResolvedNodeCreationTarget> {
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
