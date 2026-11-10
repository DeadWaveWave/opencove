import type {
  SpaceUpdateFrame,
  UpdateSpaceInput,
} from '../../../../shared/contracts/dto/spaceUpdate'
import { createAppError } from '../../../../shared/errors/appError'
import { collectAncestorSpaces, collectSpaceSubtree } from '../../../space/application/spaceTree'
import {
  expandRectToContain,
  growSpaceAncestors,
} from '../../../space/application/spaceGeometryGrowth'
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

/** Pure layout plan. Ancestor expansion changes boundaries, never sibling positions. */
export function planSpaceUpdate(workspace: NodeControlWorkspace, input: UpdateSpaceInput) {
  const target = workspace.spaces.find(space => space.id === input.spaceId)
  if (!target) {
    throw createAppError('space.not_found')
  }
  let spaces = workspace.spaces.map(space =>
    space.id === target.id ? { ...space, name: input.name ?? space.name } : space,
  )
  let nodes = workspace.nodes
  const movedNodeIds: string[] = []
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
    const dx = requested.x - target.rect.x
    const dy = requested.y - target.rect.y
    const subtree = collectSpaceSubtree(spaces, target.id)
    const subtreeIds = new Set(subtree.map(space => space.id))
    const memberIds = new Set(subtree.flatMap(space => space.nodeIds))
    nodes = workspace.nodes.map(node => {
      if (!memberIds.has(node.id) || (dx === 0 && dy === 0)) {
        return node
      }
      const position = { x: node.position.x + dx, y: node.position.y + dy }
      assertFiniteRect({ ...position, width: node.width, height: node.height })
      movedNodeIds.push(node.id)
      return { ...node, position }
    })
    spaces = spaces.map(space => {
      if (space.id === target.id) {
        return { ...space, rect: requested }
      }
      if (!subtreeIds.has(space.id) || !space.rect || (dx === 0 && dy === 0)) {
        return space
      }
      const rect = { ...space.rect, x: space.rect.x + dx, y: space.rect.y + dy }
      assertFiniteRect(rect)
      return { ...space, rect }
    })

    const nodeById = new Map(nodes.map(node => [node.id, node]))
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
            { ...node.position, width: node.width, height: node.height },
            SPACE_NODE_PADDING,
          )
        }
      }
      for (const child of spaces) {
        if (child.parentSpaceId === space.id && child.rect && !pathSpaceIds.has(child.id)) {
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
    workspace: { ...workspace, spaces, nodes },
    space: spaces.find(space => space.id === target.id)!,
    movedNodeIds,
  }
}
