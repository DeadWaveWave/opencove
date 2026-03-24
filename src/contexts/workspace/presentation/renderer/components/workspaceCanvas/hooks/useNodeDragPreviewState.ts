import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceSpaceRect } from '../../../types'

export function useWorkspaceCanvasNodeDragPreviewState(workspaceId: string): {
  nodeDragPointerAnchorRef: React.MutableRefObject<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>
  nodeSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
  nodeSpaceFramePreviewRef: React.MutableRefObject<ReadonlyMap<string, WorkspaceSpaceRect> | null>
  setNodeSpaceFramePreview: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>
  >
} {
  const nodeDragPointerAnchorRef = useRef<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>(null)
  const nodeSpaceFramePreviewRef = useRef<ReadonlyMap<string, WorkspaceSpaceRect> | null>(null)
  const [nodeSpaceFramePreview, setNodeSpaceFramePreview] = useState<ReadonlyMap<
    string,
    WorkspaceSpaceRect
  > | null>(null)
  const setNodeSpaceFramePreviewState = useCallback(
    (updater: React.SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>) => {
      setNodeSpaceFramePreview(current => {
        const next =
          typeof updater === 'function'
            ? (
                updater as (
                  current: ReadonlyMap<string, WorkspaceSpaceRect> | null,
                ) => ReadonlyMap<string, WorkspaceSpaceRect> | null
              )(current)
            : updater

        nodeSpaceFramePreviewRef.current = next
        return next
      })
    },
    [],
  )

  useEffect(() => {
    nodeDragPointerAnchorRef.current = null
    nodeSpaceFramePreviewRef.current = null
    setNodeSpaceFramePreview(null)
  }, [workspaceId])

  return {
    nodeDragPointerAnchorRef,
    nodeSpaceFramePreview,
    nodeSpaceFramePreviewRef,
    setNodeSpaceFramePreview: setNodeSpaceFramePreviewState,
  }
}
