import { useEffect, useRef, useState } from 'react'
import type { WorkspaceSpaceRect } from '../../../types'

export function useWorkspaceCanvasNodeDragPreviewState(workspaceId: string): {
  nodeDragPointerAnchorRef: React.MutableRefObject<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>
  nodeSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
  setNodeSpaceFramePreview: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>
  >
} {
  const nodeDragPointerAnchorRef = useRef<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>(null)
  const [nodeSpaceFramePreview, setNodeSpaceFramePreview] = useState<ReadonlyMap<
    string,
    WorkspaceSpaceRect
  > | null>(null)

  useEffect(() => {
    nodeDragPointerAnchorRef.current = null
    setNodeSpaceFramePreview(null)
  }, [workspaceId])

  return {
    nodeDragPointerAnchorRef,
    nodeSpaceFramePreview,
    setNodeSpaceFramePreview,
  }
}
