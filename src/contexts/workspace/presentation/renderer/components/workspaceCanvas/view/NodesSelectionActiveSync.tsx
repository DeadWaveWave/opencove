import { useWorkspaceCanvasNodesSelectionActive } from '../hooks/useNodesSelectionActive'

/**
 * Keeps React Flow's `nodesSelectionActive` in step with the selection. It renders nothing and is
 * the only subscriber to that flag and to `userSelectionActive`: a flag change renders this leaf,
 * not `WorkspaceCanvasInner`, so the first selection and a clear to none cost Inner the one render
 * of the selection write (S7, PR 3). Inner passes the count it already has.
 */
export function NodesSelectionActiveSync({
  selectedNodeCount,
}: {
  selectedNodeCount: number
}): null {
  useWorkspaceCanvasNodesSelectionActive(selectedNodeCount)
  return null
}
