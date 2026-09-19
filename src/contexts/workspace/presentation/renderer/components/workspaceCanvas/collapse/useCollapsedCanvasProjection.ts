import { useMemo } from 'react'
import type { WorkspaceCanvasViewProps } from '../WorkspaceCanvasView.types'
import { useWorkspaceCollapse } from './WorkspaceCollapseContext'
import {
  collectSpaceNodeIds,
  getCollapsedSpaceHiddenIds,
  projectCollapsedNodes,
} from '../../../utils/canvasCollapse'
import { projectSpaceDisplayRect } from './spacePresentation'

export function useCollapsedCanvasProjection({
  nodes,
  edges,
  spaces,
  spaceVisuals,
  spaceFramePreview,
}: WorkspaceCanvasViewProps) {
  const collapse = useWorkspaceCollapse()
  const projectedNodes = useMemo(
    () => projectCollapsedNodes(nodes, spaces, collapse),
    [nodes, spaces, collapse],
  )
  return useMemo(() => {
    const hidden = getCollapsedSpaceHiddenIds(spaces, collapse.collapsedSpaceIds)
    const nodeIds = new Set(nodes.map(node => node.id))
    const countForSpace = (id: string) =>
      [...collectSpaceNodeIds(id, spaces)].filter(nodeId => nodeIds.has(nodeId)).length
    return {
      nodes: projectedNodes,
      edges: edges.filter(
        edge => !hidden.nodeIds.has(edge.source) && !hidden.nodeIds.has(edge.target),
      ),
      spaceVisuals: spaceVisuals
        .filter(space => !hidden.spaceIds.has(space.id))
        .map(space => ({
          ...space,
          rect: projectSpaceDisplayRect(
            space.rect,
            collapse.collapsedSpaceIds[space.id] === true,
            countForSpace(space.id),
          ),
        })),
      spaceFramePreview: spaceFramePreview
        ? new Map(
            [...spaceFramePreview].map(([id, rect]) => [
              id,
              projectSpaceDisplayRect(
                rect,
                collapse.collapsedSpaceIds[id] === true,
                countForSpace(id),
              ),
            ]),
          )
        : null,
    }
  }, [nodes, projectedNodes, edges, spaces, spaceVisuals, spaceFramePreview, collapse])
}
