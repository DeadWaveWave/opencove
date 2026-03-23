import { useLayoutEffect, useRef } from 'react'
import { useWorkspaceCanvasNodesSelectionActive } from './useNodesSelectionActive'

export function useWorkspaceCanvasWorkspaceReset(
  workspaceId: string,
): React.MutableRefObject<string | null> {
  const exclusiveNodeDragAnchorIdRef = useRef<string | null>(null)
  useWorkspaceCanvasNodesSelectionActive()

  useLayoutEffect(() => {
    exclusiveNodeDragAnchorIdRef.current = null
  }, [workspaceId])

  return exclusiveNodeDragAnchorIdRef
}
