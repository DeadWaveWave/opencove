import { useLayoutEffect, type MutableRefObject, type RefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { subscribeWorkspaceNodeCreated } from '../nodeCreationEvents'
import { createWorkspaceCreationActivation } from '../creationActivation'

export function useWorkspaceCanvasCreationActivation({
  workspaceId,
  canvasRef,
  nodesRef,
}: {
  workspaceId: string
  canvasRef: RefObject<HTMLDivElement | null>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
}): void {
  useLayoutEffect(() => {
    const activation = createWorkspaceCreationActivation({
      getScope: () => canvasRef.current,
      getNodes: () => nodesRef.current,
    })
    const unsubscribe = subscribeWorkspaceNodeCreated(activation.request)
    return () => {
      unsubscribe()
      activation.dispose()
    }
  }, [canvasRef, nodesRef, workspaceId])
}
