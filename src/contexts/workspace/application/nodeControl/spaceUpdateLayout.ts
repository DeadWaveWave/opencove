import type {
  SpaceUpdateFrame,
  UpdateSpaceInput,
} from '../../../../shared/contracts/dto/spaceUpdate'
import { createAppError } from '../../../../shared/errors/appError'
import { collectAncestorSpaces } from '../../../space/application/spaceTree'
import {
  expandRectToContain,
  growSpaceAncestors,
} from '../../../space/application/spaceGeometryGrowth'
import { getCollapsedNodeSize } from '../../domain/collapsedNodeGeometry'
import { SPACE_NODE_PADDING } from '../../domain/workspaceSpaceLayout'
import type { NodeControlWorkspace } from './nodeControlState'

const CHILD_PADDING = 12

function assertFiniteRect(rect: SpaceUpdateFrame): void {
  if (
    ![rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(
      Number.isFinite,
    ) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'The requested space frame exceeds the supported canvas coordinates.',
    })
  }
}

/** Adjust only the target and ancestor boundaries; all contents keep their geometry. */
export function planSpaceUpdate(workspace: NodeControlWorkspace, input: UpdateSpaceInput) {
  const target = workspace.spaces.find(space => space.id === input.spaceId)
  if (!target) {
    throw createAppError('space.not_found')
  }
  let spaces = workspace.spaces.map(space =>
    space.id === target.id ? { ...space, name: input.name ?? space.name } : space,
  )
  if (input.frame) {
    if (!target.rect) {
      throw createAppError('common.invalid_input', {
        debugMessage:
          'This space has no canvas boundary. Open it in OpenCove before changing its frame.',
      })
    }
    const ancestors = collectAncestorSpaces(spaces, target.id)
    if ((ancestors.at(-1) ?? target).parentSpaceId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'This space has an invalid parent hierarchy. Its frame was not changed.',
      })
    }
    const requested = { ...target.rect, ...input.frame }
    assertFiniteRect(requested)
    spaces = spaces.map(space => (space.id === target.id ? { ...space, rect: requested } : space))
    const nodeById = new Map(workspace.nodes.map(node => [node.id, node]))
    const collapsedNodeIds = new Set(workspace.collapsedNodeIds ?? [])
    const pathSpaceIds = new Set([target.id, ...ancestors.map(space => space.id)])
    // Fit independent contents first; only the shared helper propagates the changed path.
    spaces = spaces.map(space => {
      if (!pathSpaceIds.has(space.id)) {
        return space
      }
      if (!space.rect) {
        throw createAppError('common.invalid_input', {
          debugMessage:
            'An ancestor space has no canvas boundary. Open it in OpenCove before changing this frame.',
        })
      }
      let rect = space.rect
      for (const id of space.nodeIds) {
        const node = nodeById.get(id)
        if (node) {
          rect = expandRectToContain(
            rect,
            {
              ...node.position,
              ...(collapsedNodeIds.has(node.id)
                ? getCollapsedNodeSize()
                : { width: node.width, height: node.height }),
            },
            SPACE_NODE_PADDING,
          )
        }
      }
      for (const child of spaces) {
        if (child.parentSpaceId === space.id && !pathSpaceIds.has(child.id)) {
          if (!child.rect) {
            throw createAppError('common.invalid_input', {
              debugMessage: `Cannot update this frame because child space ${JSON.stringify(child.name || child.id)} (${child.id}) has no saved canvas boundary.`,
            })
          }
          rect = expandRectToContain(rect, child.rect, CHILD_PADDING)
        }
      }
      assertFiniteRect(rect)
      return { ...space, rect }
    })
    spaces = growSpaceAncestors(spaces, target.id, CHILD_PADDING)
    for (const space of spaces) {
      if (pathSpaceIds.has(space.id) && space.rect) {
        assertFiniteRect(space.rect)
      }
    }
  }
  return {
    workspace: { ...workspace, spaces },
    space: spaces.find(space => space.id === target.id)!,
  }
}
