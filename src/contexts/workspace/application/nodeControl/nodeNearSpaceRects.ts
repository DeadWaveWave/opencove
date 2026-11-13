import type { NodeControlWorkspace } from './nodeControlState'
import { computeSpaceRectFromNodes } from '../../domain/workspaceSpaceLayout'

/** Local bounds for near creation; empty Spaces contribute no geometric obstacle. */
export function nodeNearSpaceRects(workspace: NodeControlWorkspace) {
  type Rect = NonNullable<NodeControlWorkspace['spaces'][number]['rect']>
  const rects = new Map<string, Rect | null>()
  const visiting = new Set<string>()
  const nodes = new Map(workspace.nodes.map(node => [node.id, node]))
  const spaces = new Map(workspace.spaces.map(space => [space.id, space]))
  const children = new Map<string, string[]>()
  for (const space of workspace.spaces) {
    if (space.parentSpaceId) {
      const siblings = children.get(space.parentSpaceId) ?? []
      siblings.push(space.id)
      children.set(space.parentSpaceId, siblings)
    }
  }
  const resolve = (id: string): Rect | null => {
    if (rects.has(id)) {
      return rects.get(id)!
    }
    const space = spaces.get(id)
    if (!space || visiting.has(id)) {
      return null
    }
    visiting.add(id)
    const content: Rect[] = space.nodeIds.flatMap(nodeId => {
      const node = nodes.get(nodeId)
      return node ? [{ ...node.position, width: node.width, height: node.height }] : []
    })
    for (const childId of children.get(id) ?? []) {
      const rect = resolve(childId)
      if (rect) {
        content.push(rect)
      }
    }
    const rect = space.rect ?? (content.length ? computeSpaceRectFromNodes(content) : null)
    rects.set(id, rect)
    visiting.delete(id)
    return rect
  }
  workspace.spaces.forEach(space => resolve(space.id))
  return rects
}
