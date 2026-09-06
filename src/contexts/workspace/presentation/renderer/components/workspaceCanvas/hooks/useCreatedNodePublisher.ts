import { useMemo } from 'react'
import {
  publishWorkspaceNodeCreated,
  publishWorkspaceNodeCreationPrepared,
  publishWorkspaceNodeCreationCancelled,
} from '../nodeCreationEvents'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

type SetNodes = UseWorkspaceCanvasNodesStoreResult['setNodes']

/** Wrap only the creation entry points; hydration and ordinary mutations keep the original setter. */
export function createCreatedNodePublisher(setNodes: SetNodes): SetNodes {
  return (update, options) => {
    let addedIds: string[] = []
    let preparedIds: string[] = []
    // The workspace owner commits this updater synchronously before returning.
    try {
      setNodes(previous => {
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

export function useCreatedNodePublisher(setNodes: SetNodes): SetNodes {
  return useMemo(() => createCreatedNodePublisher(setNodes), [setNodes])
}
