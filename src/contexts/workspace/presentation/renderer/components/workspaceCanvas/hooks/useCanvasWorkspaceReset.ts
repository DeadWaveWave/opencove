import { useLayoutEffect, useRef } from 'react'

export function useWorkspaceCanvasWorkspaceReset(
  workspaceId: string,
): React.MutableRefObject<string | null> {
  const exclusiveNodeDragAnchorIdRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    exclusiveNodeDragAnchorIdRef.current = null
  }, [workspaceId])

  return exclusiveNodeDragAnchorIdRef
}
