import type {
  UpdateSpaceInput,
  UpdateSpaceResult,
} from '../../../../shared/contracts/dto/spaceUpdate'
import { createAppError } from '../../../../shared/errors/appError'
import {
  persistNodeControlState,
  replaceNodeControlWorkspace,
  requireNodeControlState,
  type NodeControlAppStateStore,
} from './nodeControlState'
import { planSpaceUpdate } from './spaceUpdateLayout'

export async function updateSpace(options: {
  store: NodeControlAppStateStore
  input: UpdateSpaceInput
  assertActive?: () => void
}): Promise<UpdateSpaceResult> {
  const expectedRevision = await options.store.readAppStateRevision()
  const state = requireNodeControlState(await options.store.readAppState())
  const workspace = state.workspaces.find(candidate =>
    candidate.spaces.some(space => space.id === options.input.spaceId),
  )
  if (!workspace) {
    throw createAppError('space.not_found')
  }
  const planned = planSpaceUpdate(workspace, options.input)
  options.assertActive?.()
  await persistNodeControlState(
    options.store,
    replaceNodeControlWorkspace(state, planned.workspace),
    expectedRevision,
  )
  const { space, movedNodeIds } = planned
  return {
    id: space.id,
    name: space.name,
    projectId: workspace.id,
    parentSpaceId: space.parentSpaceId ?? null,
    rect: space.rect,
    directoryPath: space.directoryPath,
    movedNodeIds,
    ...(options.input.frame && space.rect
      ? {
          appliedFrame: space.rect,
          frameAdjusted: (['x', 'y', 'width', 'height'] as const).some(
            key =>
              options.input.frame?.[key] !== undefined &&
              options.input.frame[key] !== space.rect?.[key],
          ),
        }
      : {}),
  }
}
