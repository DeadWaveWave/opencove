import { useLayoutEffect, type RefObject } from 'react'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { subscribeWorkspaceNodeCreated } from '../nodeCreationEvents'
import { createWorkspaceCreationActivation } from '../creationActivation'

export function useWorkspaceCanvasCreationActivation({
  workspaceId,
  canvasRef,
}: {
  workspaceId: string
  canvasRef: RefObject<HTMLDivElement | null>
}): void {
  const readDocument = useReadCanvasDocument()
  useLayoutEffect(() => {
    const activation = createWorkspaceCreationActivation({
      getScope: () => canvasRef.current,
      getNodes: () => readDocument().nodes,
    })
    const unsubscribe = subscribeWorkspaceNodeCreated(activation.request)
    return () => {
      unsubscribe()
      activation.dispose()
    }
  }, [canvasRef, readDocument, workspaceId])
}
