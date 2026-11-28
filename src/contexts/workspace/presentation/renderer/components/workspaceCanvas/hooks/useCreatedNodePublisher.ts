import { useMemo } from 'react'
import {
  publishWorkspaceNodeCreated,
  publishWorkspaceNodeCreationPrepared,
  publishWorkspaceNodeCreationCancelled,
} from '../nodeCreationEvents'
import { useCanvasNodeWriter, type CanvasNodeWriter } from './useCanvasNodeWriter'

type UpdateNodes = CanvasNodeWriter['updateNodes']

/** Wrap only the creation entry points; hydration and ordinary mutations keep the original writer. */
export function createCreatedNodePublisher(updateNodes: UpdateNodes): UpdateNodes {
  return (update, options) => {
    let addedIds: string[] = []
    let preparedIds: string[] = []
    // The workspace owner commits this updater synchronously before returning.
    try {
      updateNodes(previous => {
        const next = update(previous)
        const previousIds = new Set(previous.map(node => node.id))
        const addedNodes = next.filter(node => !previousIds.has(node.id))
        addedIds = addedNodes.map(node => node.id)
        preparedIds = addedIds
        publishWorkspaceNodeCreationPrepared(preparedIds, performance.now())
        return next
      }, options)
    } catch (error) {
      publishWorkspaceNodeCreationCancelled(preparedIds)
      throw error
    }
    addedIds.forEach(publishWorkspaceNodeCreated)
  }
}

/**
 * The creators' writer: the canvas's node writer of this render's workspace (Decision 8 of S7),
 * publishing each created window once. A creator takes it from here, not as a parameter.
 */
export function useCreatedNodePublisher(): UpdateNodes {
  const { updateNodes } = useCanvasNodeWriter()
  return useMemo(() => createCreatedNodePublisher(updateNodes), [updateNodes])
}
